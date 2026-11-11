const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { getKaprodiUserIds } = require("../utils/identity");
const mahasiswaService = require("./mahasiswa.service");

async function notifyKaprodiOfOutline(conn, programStudiId, type, message) {
  for (const userId of await getKaprodiUserIds(conn, programStudiId)) {
    await insertNotification(
      conn,
      userId,
      type,
      message,
      "/kaprodi/pengajuan-outline/outlines",
    );
  }
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

async function createOutline(
  judul,
  npm,
  programStudiId,
  submissionPeriodId,
  fileOutline,
  fileOutlineName,
  namaMahasiswa,
) {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    // Lock the student's row so two submits at once can't both pass the checks below and
    // create two active outlines.
    await conn.query(`SELECT npm FROM mahasiswa WHERE npm = ? FOR UPDATE`, [npm]);
    if (await hasNonRejectedOutline(npm, conn)) {
      throw conflict("Anda masih memiliki outline yang sedang berjalan.");
    }
    if (await hasActiveSkripsi(npm, conn)) {
      throw conflict("Anda masih memiliki skripsi yang sedang berjalan.");
    }

    const [insertResult] = await conn.query(
      `INSERT INTO outline
             (judul, npm, status, program_studi_id, submission_period_id)
             VALUES (?, ?, 'SUBMITTED', ?, ?)`,
      [judul, npm, programStudiId, submissionPeriodId],
    );

    const outlineId = insertResult?.insertId ?? null;
    if (outlineId) {
      await conn.query(
        `INSERT INTO outline_submissions
               (outline_id, submission_no, file_content, file_name)
               VALUES (?, 1, ?, ?)`,
        [outlineId, fileOutline, fileOutlineName ?? null],
      );
    }

    await notifyKaprodiOfOutline(
      conn,
      programStudiId,
      "OUTLINE_SUBMITTED",
      `Mahasiswa ${namaMahasiswa} mengajukan outline baru`,
    );

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

// An outline whose skripsi ended GAGAL (Sidang Skripsi GAGAL or Seminar JUDUL_DITOLAK) no
// longer blocks: the student starts over with a new outline right away.
async function hasNonRejectedOutline(npm, queryable = db) {
  const [rows] = await queryable.query(
    `SELECT o.id
     FROM outline o
     LEFT JOIN skripsi sk ON sk.outline_id = o.id AND sk.status = 'GAGAL'
     WHERE o.npm = ? AND o.status <> 'REJECTED' AND sk.id IS NULL
     LIMIT 1`,
    [npm],
  );
  return rows.length > 0;
}

// The student's current cycle is their newest outline; student-facing "latest/me" reads
// scope to it so a restart doesn't surface the failed cycle's disposisi, kartu or skripsi.
async function getCurrentOutlineId(npm) {
  const [[row]] = await db.query(
    `SELECT id FROM outline WHERE npm = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [npm],
  );
  return row?.id ?? null;
}

async function getLatestFailure(npm) {
  const [[row]] = await db.query(
    `SELECT sk.id AS skripsi_id, sk.outline_id, s.hasil_sidang, shp.submitted_at AS verdict_at
     FROM skripsi sk
     JOIN sidang s ON s.skripsi_id = sk.id AND s.hasil_sidang IN ('GAGAL', 'JUDUL_DITOLAK')
     JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id AND shp.submitted_at IS NOT NULL
     WHERE sk.npm = ? AND sk.status = 'GAGAL'
     ORDER BY shp.submitted_at DESC, s.id DESC
     LIMIT 1`,
    [npm],
  );
  return row ?? null;
}

// After a failure the student submits a new outline right away; this only tells the pages
// which verdict to explain while the failed outline is still the newest.
async function getRestartStatus(npm) {
  const failure = await getLatestFailure(npm);
  if (!failure) return null;
  return {
    outlineId: failure.outline_id,
    hasilSidang: failure.hasil_sidang,
    verdictAt: failure.verdict_at,
  };
}

async function hasActiveSkripsi(npm, queryable = db) {
  const [[activeSkripsi]] = await queryable.query(
    `SELECT id FROM skripsi WHERE npm = ? AND status = 'IN_PROGRESS' LIMIT 1`,
    [npm],
  );
  return Boolean(activeSkripsi);
}

async function getOutlineDetailById(id, studentNpm) {
  const whereNpm = studentNpm ? "AND o.npm = ?" : "";
  const params = studentNpm ? [id, studentNpm] : [id];

  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.npm,
       o.status,
       rev.decision_note,
       o.created_at,
       o.updated_at,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       ps.nama AS program_studi_nama,
       (sub.file_content IS NOT NULL) AS has_file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       (rev.file_content IS NOT NULL) AS has_file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       sub.submission_no AS file_revision_no,
       sub.submitted_at AS file_updated_at,
       prev_rev.decision_note AS previous_decision_note
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN program_studi ps ON ps.id = m.program_studi_id
     LEFT JOIN outline_submissions sub
       ON sub.outline_id = o.id
      AND sub.submission_no = (
        SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     LEFT JOIN outline_submissions prev_sub
       ON prev_sub.outline_id = o.id
      AND prev_sub.submission_no = (
        SELECT MAX(submission_no) - 1 FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews prev_rev ON prev_rev.submission_id = prev_sub.id
     WHERE o.id = ? ${whereNpm}
     LIMIT 1`,
    params,
  );

  return rows[0] ?? null;
}

async function getRejectedOutlinesByNpm(npm, excludeId) {
  const [rows] = await db.query(
    `SELECT
       id,
       judul,
       status,
       created_at,
       updated_at
     FROM outline
     WHERE npm = ?
       AND id <> ?
       AND status = 'REJECTED'
     ORDER BY created_at DESC`,
    [npm, excludeId],
  );
  return rows;
}

async function getLatestOutlineByNpm(npm) {
  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.npm,
       o.status,
       rev.decision_note,
       o.created_at,
       o.updated_at,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       ps.nama AS program_studi_nama,
       (sub.file_content IS NOT NULL) AS has_file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       (rev.file_content IS NOT NULL) AS has_file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       sub.submission_no AS file_revision_no,
       sub.submitted_at AS file_updated_at
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN program_studi ps ON ps.id = m.program_studi_id
     LEFT JOIN outline_submissions sub
       ON sub.outline_id = o.id
      AND sub.submission_no = (
        SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     WHERE o.npm = ?
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT 1`,
    [npm],
  );

  return rows[0] ?? null;
}


async function getOutlineReviewHistory(id) {
  const [rows] = await db.query(
    `SELECT
       sub.submission_no AS revision_no,
       (sub.file_content IS NOT NULL) AS has_file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       (rev.file_content IS NOT NULL) AS has_file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       rev.decision_note,
       sub.submitted_at AS updated_at,
       o.id AS outline_id,
       o.judul,
       o.status
     FROM outline_submissions sub
     INNER JOIN outline o ON o.id = sub.outline_id
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     WHERE o.id = ?
     ORDER BY sub.submission_no DESC`,
    [id],
  );
  return rows;
}

// One file of one outline version — the reads above only say whether a file exists, so pages
// fetch the content on download. `kind` is MAHASISWA (the student's upload) or KAPRODI (the
// annotated copy on that version's review); no submissionNo means the latest version.
async function getOutlineFile(outlineId, kind, submissionNo) {
  const column = kind === "KAPRODI" ? "rev" : "sub";
  const [rows] = await db.query(
    `SELECT ${column}.file_content, ${column}.file_name
     FROM outline_submissions sub
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     WHERE sub.outline_id = ?
       ${submissionNo ? "AND sub.submission_no = ?" : ""}
     ORDER BY sub.submission_no DESC
     LIMIT 1`,
    submissionNo ? [outlineId, submissionNo] : [outlineId],
  );
  return rows[0]?.file_content ? rows[0] : null;
}

async function listOutlinesForKaprodi({
  programStudiIds,
  status,
  q,
  tahunAkademik,
  periodeAkademik,
  pagination,
}) {
  const where = ["m.program_studi_id IN (?)"];
  const params = [programStudiIds];

  if (status) {
    where.push("o.status = ?");
    params.push(status);
  }
  if (q) {
    const searchValue = `%${q}%`;
    where.push("(o.judul LIKE ? OR m.nama LIKE ? OR m.npm LIKE ?)");
    params.push(searchValue, searchValue, searchValue);
  }
  if (tahunAkademik) {
    where.push("osp.tahun_akademik = ?");
    params.push(tahunAkademik);
  }
  if (periodeAkademik) {
    where.push("osp.periode_akademik = ?");
    params.push(periodeAkademik);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN (
       SELECT npm, MAX(id) AS max_id
       FROM outline
       GROUP BY npm
     ) latest ON latest.npm = o.npm AND latest.max_id = o.id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     ${whereSql}`,
    params,
  );

  const pageSql = pagination?.enabled ? " LIMIT ? OFFSET ?" : "";
  const dataParams = pagination?.enabled
    ? [...params, pagination.limit, pagination.offset]
    : params;

  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.status,
       o.created_at,
       o.updated_at,
       o.npm,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       o.submission_period_id,
       osp.tahun_akademik AS period_tahun_akademik,
       osp.periode_akademik AS period_periode_akademik
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN (
       SELECT npm, MAX(id) AS max_id
       FROM outline
       GROUP BY npm
     ) latest ON latest.npm = o.npm AND latest.max_id = o.id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     ${whereSql}
     ORDER BY o.created_at DESC${pageSql}`,
    dataParams,
  );

  return { rows, totalItems: Number(countRow.total) };
}

async function isOutlineInProdi(id, programStudiIds) {
  if (!programStudiIds?.length) return false;
  const [rows] = await db.query(
    `SELECT o.id
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     WHERE o.id = ? AND m.program_studi_id IN (?)
     LIMIT 1`,
    [id, programStudiIds],
  );
  return rows.length > 0;
}

// Locks the outline row so a concurrent review/resubmit can't slip past the check.
async function assertOutlineStatus(conn, outlineId, expected, message) {
  const [[row]] = await conn.query(
    `SELECT status FROM outline WHERE id = ? LIMIT 1 FOR UPDATE`,
    [outlineId],
  );
  if (row?.status !== expected) {
    throw Object.assign(new Error(message), { statusCode: 409 });
  }
}

async function reviewOutlineByKaprodi(
  outlineId,
  status,
  note,
  kaprodiFile,
  kaprodiFileOutlineName,
) {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    // Only a submission waiting for Kaprodi can be decided; re-deciding would overwrite the
    // review of that submission or undo an ACCEPTED outline that later steps build on.
    await assertOutlineStatus(conn, outlineId, "SUBMITTED", "Outline ini tidak sedang menunggu review Kaprodi.");

    await conn.query(`UPDATE outline SET status = ? WHERE id = ?`, [
      status,
      outlineId,
    ]);

    const [[latestSub]] = await conn.query(
      `SELECT id FROM outline_submissions
       WHERE outline_id = ?
       ORDER BY submission_no DESC
       LIMIT 1`,
      [outlineId],
    );

    if (latestSub) {
      await conn.query(
        `INSERT INTO outline_reviews (submission_id, decision_note, file_content, file_name, reviewed_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           decision_note = VALUES(decision_note),
           file_content  = VALUES(file_content),
           file_name     = VALUES(file_name),
           reviewed_at   = VALUES(reviewed_at)`,
        [
          latestSub.id,
          note.length ? note : null,
          kaprodiFile,
          kaprodiFile ? (kaprodiFileOutlineName ?? null) : null,
        ],
      );
    }

    if (status !== "SUBMITTED") {
      const [oStudentRows] = await conn.query(
        `SELECT u.id, m.nama FROM outline o
         JOIN mahasiswa m ON m.npm = o.npm
         JOIN users u ON u.npm = o.npm
         WHERE o.id = ? LIMIT 1`,
        [outlineId],
      );
      const studentUserId = oStudentRows[0]?.id ?? null;
      if (studentUserId) {
        const typeMap = {
          NEED_REVISION: "OUTLINE_NEED_REVISION",
          REJECTED: "OUTLINE_REJECTED",
          ACCEPTED: "OUTLINE_ACCEPTED",
        };
        const msgMap = {
          NEED_REVISION: "Outline Anda memerlukan revisi",
          REJECTED: "Outline Anda ditolak",
          ACCEPTED: "Outline Anda diterima",
        };
        await insertNotification(
          conn,
          studentUserId,
          typeMap[status],
          msgMap[status],
          "/student/pengajuan-outline",
        );
      }
    }

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function isOutlineOwnedByStudent(outlineId, npm) {
  const [rows] = await db.query(
    `SELECT id FROM outline WHERE id = ? AND npm = ? LIMIT 1`,
    [outlineId, npm],
  );
  return rows.length > 0;
}

async function resubmitOutline(
  outlineId,
  npm,
  programStudiId,
  judulVal,
  fileVal,
  fileNameVal,
) {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    await assertOutlineStatus(conn, outlineId, "NEED_REVISION", "Outline hanya dapat diajukan ulang saat berstatus Perlu Revisi.");

    const sets = [];
    const params = [];

    if (judulVal !== null && judulVal.length > 0) {
      sets.push("judul = ?");
      params.push(judulVal);
    }
    sets.push("program_studi_id = ?");
    params.push(programStudiId);
    sets.push("status = 'SUBMITTED'");

    const sql = `UPDATE outline SET ${sets.join(", ")} WHERE id = ?`;
    params.push(outlineId);

    await conn.query(sql, params);

    // Always a new version (the controller requires the file), so the next review gets its own row.
    const [[maxRow]] = await conn.query(
      `SELECT MAX(submission_no) AS max_sub
       FROM outline_submissions
       WHERE outline_id = ?`,
      [outlineId],
    );
    const nextSub = Number(maxRow?.max_sub || 0) + 1;
    await conn.query(
      `INSERT INTO outline_submissions
       (outline_id, submission_no, file_content, file_name)
       VALUES (?, ?, ?, ?)`,
      [outlineId, nextSub, fileVal, fileNameVal ?? null],
    );

    const namaMahasiswa = await mahasiswaService.getMahasiswaNameByNpm(npm);

    await notifyKaprodiOfOutline(
      conn,
      programStudiId,
      "OUTLINE_RESUBMITTED",
      `Mahasiswa ${namaMahasiswa} mengajukan ulang outline`,
    );

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  createOutline,
  hasNonRejectedOutline,
  getCurrentOutlineId,
  getRestartStatus,
  hasActiveSkripsi,
  getOutlineDetailById,
  getRejectedOutlinesByNpm,
  getLatestOutlineByNpm,
  getOutlineReviewHistory,
  getOutlineFile,
  listOutlinesForKaprodi,
  isOutlineInProdi,
  reviewOutlineByKaprodi,
  isOutlineOwnedByStudent,
  resubmitOutline,
};
