"use strict";

const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");
const { insertNotification } = require("../utils/notify");

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const RECIPIENT_ROLES = [
  "PERPUSTAKAAN",
  "LPPM",
  "PEMBIMBING_1",
  "PEMBIMBING_2",
  "PENGUJI_1",
  "PENGUJI_2",
];

function formatTanggal(date) {
  const d = new Date(date);
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (!signatureValue) return null;
  const base64 = signatureValue.includes(",")
    ? signatureValue.split(",")[1]
    : signatureValue;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

function signaturePatch(signatureValue) {
  const buf = decodeSignatureToBuffer(signatureValue);
  if (!buf) return textPatch("");
  return {
    type: PatchType.PARAGRAPH,
    children: [new ImageRun({ data: buf, transformation: { width: 100, height: 50 } })],
  };
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getSigByUserId(conn, userId) {
  if (!userId) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return row?.signature_image ?? null;
}

async function getSigByNpm(conn, npm) {
  if (!npm) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return row?.signature_image ?? null;
}

async function getSigByRole(conn, role, userIdForRole) {
  if (!userIdForRole) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userIdForRole],
  );
  return row?.signature_image ?? null;
}

async function resolveUserId(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE nidn = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    [nidn],
  );
  return row?.id ?? null;
}

async function getUserIdByNpm(conn, npm) {
  if (!npm) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return row?.id ?? null;
}

async function getUserIdByRole(conn, role) {
  const [[row]] = await conn.query(
    `SELECT u.id FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.code = ? AND ur.is_active = 1 AND u.is_active = 1
     LIMIT 1`,
    [role],
  );
  return row?.id ?? null;
}

async function getPengajuanDisposisiPembimbingRecord(conn, skripsiId) {
  const [[row]] = await conn.query(
    `SELECT sk.npm, sk.status as skripsi_status,
            s.id as sidang_id,
            s.pembimbing1_nidn, s.pembimbing2_nidn,
            s.penguji1_nidn, s.penguji2_nidn,
            s.nama_mahasiswa, s.judul_skripsi, s.program_studi_id, s.program_studi_nama,
            rps.id as revisi_id, rps.is_completed as revisi_completed
     FROM skripsi sk
     LEFT JOIN sidang s ON s.skripsi_id = sk.id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = sk.id)
     LEFT JOIN revisi_pasca_sidang rps ON rps.sidang_id = s.id
     WHERE sk.id = ?
     LIMIT 1`,
    [skripsiId],
  );
  return row ?? null;
}

async function generateSuratDoc(conn, pengumpulan, sidangRow, confirmations, sekprodiSig, namaSekprodi) {
  const [mhsRow] = await conn.query(
    `SELECT m.nama, m.npm, psk.no_hp
     FROM mahasiswa m
     LEFT JOIN pengajuan_sidang ps_ref ON ps_ref.skripsi_id = ? AND ps_ref.status = 'COMPLETED'
     LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = ps_ref.id
     WHERE m.npm = ?
     LIMIT 1`,
    [pengumpulan.skripsi_id, pengumpulan.npm],
  );
  const mhs = mhsRow[0] ?? {};

  const [[psRow]] = await conn.query(
    `SELECT ps.nama as prodi_nama, ps.sekprodi_nidn
     FROM program_studi ps
     INNER JOIN sidang s ON s.skripsi_id = ?
     WHERE ps.id = s.program_studi_id
     LIMIT 1`,
    [pengumpulan.skripsi_id],
  );

  const [[skripsiRow]] = await conn.query(
    `SELECT judul FROM skripsi WHERE id = ? LIMIT 1`,
    [pengumpulan.skripsi_id],
  );

  const confMap = {};
  for (const c of confirmations) {
    confMap[c.recipient_role] = c;
  }

  const perpusSig = confMap["PERPUSTAKAAN"]?.user_id
    ? await getSigByRole(conn, "PERPUSTAKAAN", confMap["PERPUSTAKAAN"].user_id)
    : null;
  const lppmSig = confMap["LPPM"]?.user_id
    ? await getSigByRole(conn, "LPPM", confMap["LPPM"].user_id)
    : null;

  const [sigMhs, sigPb1, sigPb2, sigPg1, sigPg2] = await Promise.all([
    getSigByNpm(conn, pengumpulan.npm),
    getSigByUserId(conn, confMap["PEMBIMBING_1"]?.user_id ?? null),
    getSigByUserId(conn, confMap["PEMBIMBING_2"]?.user_id ?? null),
    getSigByUserId(conn, confMap["PENGUJI_1"]?.user_id ?? null),
    getSigByUserId(conn, confMap["PENGUJI_2"]?.user_id ?? null),
  ]);

  const tanggalDibuat = formatTanggal(new Date());

  const templatePath = path.join(
    __dirname,
    "../templates/template_surat_keterangan_penyerahan_skripsi.docx",
  );
  const templateBuffer = await readFile(templatePath);

  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches: {
      nama_mahasiswa: textPatch(mhs.nama ?? sidangRow?.nama_mahasiswa ?? ""),
      npm: textPatch(pengumpulan.npm),
      no_hp: textPatch(mhs.no_hp ?? ""),
      prodi: textPatch(psRow?.prodi_nama ?? sidangRow?.program_studi_nama ?? ""),
      judul_skripsi: textPatch(skripsiRow?.judul ?? sidangRow?.judul_skripsi ?? ""),
      tanggal_terima_perpus: textPatch(
        confMap["PERPUSTAKAAN"]?.confirmed_at ? formatTanggal(confMap["PERPUSTAKAAN"].confirmed_at) : "",
      ),
      tanggal_terima_lppm: textPatch(
        confMap["LPPM"]?.confirmed_at ? formatTanggal(confMap["LPPM"].confirmed_at) : "",
      ),
      tanggal_terima_pembimbing1: textPatch(
        confMap["PEMBIMBING_1"]?.confirmed_at ? formatTanggal(confMap["PEMBIMBING_1"].confirmed_at) : "",
      ),
      tanggal_terima_pembimbing2: textPatch(
        confMap["PEMBIMBING_2"]?.confirmed_at ? formatTanggal(confMap["PEMBIMBING_2"].confirmed_at) : "",
      ),
      tanggal_terima_penguji1: textPatch(
        confMap["PENGUJI_1"]?.confirmed_at ? formatTanggal(confMap["PENGUJI_1"].confirmed_at) : "",
      ),
      tanggal_terima_penguji2: textPatch(
        confMap["PENGUJI_2"]?.confirmed_at ? formatTanggal(confMap["PENGUJI_2"].confirmed_at) : "",
      ),
      ttd_perpustakaan: signaturePatch(perpusSig),
      ttd_lppm: signaturePatch(lppmSig),
      ttd_pembimbing1: signaturePatch(sigPb1),
      ttd_pembimbing2: signaturePatch(sigPb2),
      ttd_penguji1: signaturePatch(sigPg1),
      ttd_penguji2: signaturePatch(sigPg2),
      ttd_mahasiswa: signaturePatch(sigMhs),
      ttd_sekprodi: sekprodiSig ? signaturePatch(sekprodiSig) : textPatch(""),
      nama_sekprodi: textPatch(namaSekprodi ?? ""),
      tanggal_dibuat: textPatch(tanggalDibuat),
    },
  });

  return outputBuffer;
}

// POST /pengumpulan-berkas-final/:skripsiId/init
exports.initPengumpulan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(403).json({ ok: false, message: "Forbidden" });

    await conn.beginTransaction();
    txStarted = true;

    const [[skripsiRow]] = await conn.query(
      `SELECT id, npm FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!skripsiRow) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Skripsi tidak ditemukan" });
    }
    if (skripsiRow.npm !== npm) {
      await conn.rollback(); txStarted = false;
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    // Prerequisite: revisi_pasca_sidang.is_completed = 1
    const [[revisiRow]] = await conn.query(
      `SELECT rps.id, rps.is_completed
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisiRow || !revisiRow.is_completed) {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Revisi pasca sidang belum selesai" });
    }

    // Prerequisite: latest sidang must be LULUS
    const [[latestSidang]] = await conn.query(
      `SELECT hasil_sidang FROM sidang WHERE skripsi_id = ? ORDER BY id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!latestSidang || latestSidang.hasil_sidang !== "LULUS") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Sidang terakhir belum dinyatakan lulus" });
    }

    // Return existing if already exists
    const [[existing]] = await conn.query(
      `SELECT id, status, is_completed FROM pengumpulan_berkas_final WHERE skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (existing) {
      await conn.rollback(); txStarted = false;
      return res.json({ ok: true, data: { id: existing.id, status: existing.status, is_completed: existing.is_completed } });
    }

    const [result] = await conn.query(
      `INSERT INTO pengumpulan_berkas_final (skripsi_id, status) VALUES (?, 'DRAFT')`,
      [skripsiId],
    );

    await conn.commit(); txStarted = false;
    return res.status(201).json({ ok: true, data: { id: result.insertId, status: "DRAFT", is_completed: 0 } });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /pengumpulan-berkas-final/:skripsiId/submit
exports.submitPengumpulan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(403).json({ ok: false, message: "Forbidden" });

    const { fileSkripsi, artikelPenelitian } = req.body;
    if (
      !fileSkripsi?.fileContent || !fileSkripsi?.fileName ||
      !artikelPenelitian?.fileContent || !artikelPenelitian?.fileName
    ) {
      return res.status(400).json({ ok: false, message: "fileSkripsi dan artikelPenelitian wajib diisi" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[pengumpulan]] = await conn.query(
      `SELECT pbf.id, pbf.status, sk.npm,
              s.pembimbing1_nidn, s.pembimbing2_nidn, s.penguji1_nidn, s.penguji2_nidn
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       WHERE pbf.skripsi_id = ? AND sk.npm = ?
       LIMIT 1`,
      [skripsiId, npm],
    );
    if (!pengumpulan) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas belum diinisiasi" });
    }
    if (pengumpulan.status === "COMPLETED") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Pengumpulan sudah selesai" });
    }

    // Upsert FILE_SKRIPSI
    await conn.query(
      `DELETE FROM pengumpulan_berkas_final_files WHERE pengumpulan_id = ? AND file_type = 'FILE_SKRIPSI'`,
      [pengumpulan.id],
    );
    await conn.query(
      `INSERT INTO pengumpulan_berkas_final_files (pengumpulan_id, file_type, file_name, mime_type, file_content)
       VALUES (?, 'FILE_SKRIPSI', ?, ?, ?)`,
      [pengumpulan.id, fileSkripsi.fileName, fileSkripsi.mimeType ?? null, fileSkripsi.fileContent],
    );

    // Upsert ARTIKEL_PENELITIAN
    await conn.query(
      `DELETE FROM pengumpulan_berkas_final_files WHERE pengumpulan_id = ? AND file_type = 'ARTIKEL_PENELITIAN'`,
      [pengumpulan.id],
    );
    await conn.query(
      `INSERT INTO pengumpulan_berkas_final_files (pengumpulan_id, file_type, file_name, mime_type, file_content)
       VALUES (?, 'ARTIKEL_PENELITIAN', ?, ?, ?)`,
      [pengumpulan.id, artikelPenelitian.fileName, artikelPenelitian.mimeType ?? null, artikelPenelitian.fileContent],
    );

    // Resolve user_ids for PERPUSTAKAAN_STAFF and LPPM
    const perpustakaanUserId = await getUserIdByRole(conn, "PERPUSTAKAAN_STAFF");
    const lppmUserId = await getUserIdByRole(conn, "LPPM");

    // Recreate confirmation rows on every submit
    await conn.query(
      `DELETE FROM pengumpulan_berkas_final_confirmations WHERE pengumpulan_id = ?`,
      [pengumpulan.id],
    );

    const [pb1UserId, pb2UserId, pg1UserId, pg2UserId] = await Promise.all([
      resolveUserId(conn, pengumpulan.pembimbing1_nidn),
      resolveUserId(conn, pengumpulan.pembimbing2_nidn),
      resolveUserId(conn, pengumpulan.penguji1_nidn),
      resolveUserId(conn, pengumpulan.penguji2_nidn),
    ]);
    const confirmRows = [
      { role: "PERPUSTAKAAN", userId: perpustakaanUserId },
      { role: "LPPM",         userId: lppmUserId },
      { role: "PEMBIMBING_1", userId: pb1UserId },
      { role: "PEMBIMBING_2", userId: pb2UserId },
      { role: "PENGUJI_1",    userId: pg1UserId },
      { role: "PENGUJI_2",    userId: pg2UserId },
    ];

    for (const row of confirmRows) {
      await conn.query(
        `INSERT INTO pengumpulan_berkas_final_confirmations (pengumpulan_id, recipient_role, user_id)
         VALUES (?, ?, ?)`,
        [pengumpulan.id, row.role, row.userId ?? null],
      );
    }

    // Update status to SUBMITTED
    await conn.query(
      `UPDATE pengumpulan_berkas_final SET status = 'SUBMITTED' WHERE id = ?`,
      [pengumpulan.id],
    );

    // Notify all 6 recipients
    const link = `/pengumpulan-berkas-final/${skripsiId}`;
    for (const row of confirmRows) {
      if (row.userId) {
        await insertNotification(
          conn,
          row.userId,
          "PENGUMPULAN_BERKAS_FINAL",
          `Mahasiswa dengan npm ${npm} telah mengunggah berkas final skripsi. Silakan konfirmasi penerimaan.`,
          link,
        );
      }
    }

    await conn.commit(); txStarted = false;
    return res.json({ ok: true, data: { id: pengumpulan.id, status: "SUBMITTED" } });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /pengumpulan-berkas-final/:skripsiId/confirm
exports.confirmPengumpulan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const userId = Number(req.user.id);
    const userRoles = req.user.roles ?? [];

    await conn.beginTransaction();
    txStarted = true;

    const [[pengumpulan]] = await conn.query(
      `SELECT pbf.id, pbf.status, pbf.skripsi_id, sk.npm,
              s.pembimbing1_nidn, s.pembimbing2_nidn, s.penguji1_nidn, s.penguji2_nidn,
              s.program_studi_id
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       WHERE pbf.skripsi_id = ?
       LIMIT 1`,
      [skripsiId],
    );
    if (!pengumpulan) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }
    if (pengumpulan.status !== "SUBMITTED") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Berkas belum disubmit oleh mahasiswa" });
    }

    // Determine which confirmation row this user matches
    let matchedRole = null;

    if (userRoles.includes("PERPUSTAKAAN_STAFF")) {
      matchedRole = "PERPUSTAKAAN";
    } else if (userRoles.includes("LPPM")) {
      matchedRole = "LPPM";
    } else {
      // Dosen: match by NIDN
      const nidn = await getLecturerNidn(userId);
      if (nidn) {
        if (nidn === pengumpulan.pembimbing1_nidn) matchedRole = "PEMBIMBING_1";
        else if (nidn === pengumpulan.pembimbing2_nidn) matchedRole = "PEMBIMBING_2";
        else if (nidn === pengumpulan.penguji1_nidn) matchedRole = "PENGUJI_1";
        else if (nidn === pengumpulan.penguji2_nidn) matchedRole = "PENGUJI_2";
      }
    }

    if (!matchedRole) {
      await conn.rollback(); txStarted = false;
      return res.status(403).json({ ok: false, message: "Anda tidak termasuk penerima berkas ini" });
    }

    const [[confRow]] = await conn.query(
      `SELECT id, confirmed_at FROM pengumpulan_berkas_final_confirmations
       WHERE pengumpulan_id = ? AND recipient_role = ?
       LIMIT 1`,
      [pengumpulan.id, matchedRole],
    );
    if (!confRow) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Data konfirmasi tidak ditemukan" });
    }
    if (confRow.confirmed_at) {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Anda sudah mengkonfirmasi sebelumnya" });
    }

    await conn.query(
      `UPDATE pengumpulan_berkas_final_confirmations
       SET confirmed_at = NOW(), user_id = ?
       WHERE id = ?`,
      [userId, confRow.id],
    );

    // Check if all 6 have confirmed
    const [[{ total, confirmed }]] = await conn.query(
      `SELECT COUNT(*) as total, SUM(confirmed_at IS NOT NULL) as confirmed
       FROM pengumpulan_berkas_final_confirmations
       WHERE pengumpulan_id = ?`,
      [pengumpulan.id],
    );

    if (Number(confirmed) === Number(total)) {
      // All confirmed — generate Surat Pernyataan Penyerahan
      const allConfs = await conn.query(
        `SELECT recipient_role, user_id, confirmed_at
         FROM pengumpulan_berkas_final_confirmations
         WHERE pengumpulan_id = ?`,
        [pengumpulan.id],
      );
      const confirmations = allConfs[0];

      const sidangRows = await conn.query(
        `SELECT * FROM sidang WHERE skripsi_id = ? ORDER BY id DESC LIMIT 1`,
        [skripsiId],
      );
      const sidangRow = sidangRows[0][0] ?? null;

      const pengumpulanFull = { ...pengumpulan };
      const docBuffer = await generateSuratDoc(conn, pengumpulanFull, sidangRow, confirmations, null, "");

      await conn.query(
        `DELETE FROM pengumpulan_berkas_final_files
         WHERE pengumpulan_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYERAHAN'`,
        [pengumpulan.id],
      );
      await conn.query(
        `INSERT INTO pengumpulan_berkas_final_files (pengumpulan_id, file_type, file_name, file_content)
         VALUES (?, 'SURAT_PERNYATAAN_PENYERAHAN', 'surat_pernyataan_penyerahan_skripsi.docx', ?)`,
        [pengumpulan.id, docBuffer.toString("base64")],
      );

      await conn.query(
        `UPDATE pengumpulan_berkas_final SET status = 'WAITING_SIGNATURE' WHERE id = ?`,
        [pengumpulan.id],
      );

      // Notify SEKPRODI of this prodi
      if (pengumpulan.program_studi_id) {
        const [[psRow]] = await conn.query(
          `SELECT sekprodi_nidn FROM program_studi WHERE id = ? LIMIT 1`,
          [pengumpulan.program_studi_id],
        );
        if (psRow?.sekprodi_nidn) {
          const sekprodiUserId = await resolveUserId(conn, psRow.sekprodi_nidn);
          if (sekprodiUserId) {
            await insertNotification(
              conn,
              sekprodiUserId,
              "PENGUMPULAN_BERKAS_FINAL",
              `Semua pihak telah mengkonfirmasi berkas final skripsi mahasiswa npm ${pengumpulan.npm}. Silakan tanda tangani surat penyerahan.`,
              `/pengumpulan-berkas-final/${skripsiId}`,
            );
          }
        }
      }

      // Also notify student
      const studentUserId = await getUserIdByNpm(conn, pengumpulan.npm);
      if (studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "PENGUMPULAN_BERKAS_FINAL",
          "Semua pihak telah mengkonfirmasi berkas final skripsi Anda. Menunggu tanda tangan Sekretaris Prodi.",
          `/pengumpulan-berkas-final/${skripsiId}`,
        );
      }
    } else {
      // Notify student about partial confirmation
      const studentUserId = await getUserIdByNpm(conn, pengumpulan.npm);
      if (studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "PENGUMPULAN_BERKAS_FINAL",
          `Konfirmasi penerimaan berkas telah diterima (${confirmed}/${total}).`,
          `/pengumpulan-berkas-final/${skripsiId}`,
        );
      }
    }

    await conn.commit(); txStarted = false;
    return res.json({ ok: true, data: { confirmed: Number(confirmed), total: Number(total) } });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /pengumpulan-berkas-final/:skripsiId/sign
exports.signPengumpulan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const userId = Number(req.user.id);

    if (!req.user.hasRole("SEKPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[pengumpulan]] = await conn.query(
      `SELECT pbf.id, pbf.status, pbf.skripsi_id, sk.npm,
              s.program_studi_id, s.pembimbing1_nidn, s.pembimbing2_nidn,
              s.penguji1_nidn, s.penguji2_nidn
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       WHERE pbf.skripsi_id = ?
       LIMIT 1`,
      [skripsiId],
    );
    if (!pengumpulan) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }
    if (pengumpulan.status !== "WAITING_SIGNATURE") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({ ok: false, message: "Belum semua pihak mengkonfirmasi penerimaan" });
    }

    // Verify sekprodi belongs to this prodi
    const [[sekprodiUserRow]] = await conn.query(
      `SELECT u.nidn FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ? AND r.code = 'SEKPRODI' AND ur.is_active = 1
       LIMIT 1`,
      [userId],
    );
    if (!sekprodiUserRow) {
      await conn.rollback(); txStarted = false;
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (pengumpulan.program_studi_id) {
      const [[psRow]] = await conn.query(
        `SELECT sekprodi_nidn FROM program_studi WHERE id = ? LIMIT 1`,
        [pengumpulan.program_studi_id],
      );
      if (psRow?.sekprodi_nidn && psRow.sekprodi_nidn !== sekprodiUserRow.nidn) {
        await conn.rollback(); txStarted = false;
        return res.status(403).json({ ok: false, message: "Anda bukan Sekretaris Prodi dari program studi ini" });
      }
    }

    // Get sekprodi signature and nama
    const [[sekprodiSigRow]] = await conn.query(
      `SELECT u.signature_image FROM users u WHERE u.id = ? LIMIT 1`,
      [userId],
    );
    const [[dosRow]] = await conn.query(
      `SELECT d.nama FROM dosen d WHERE d.nidn = ? LIMIT 1`,
      [sekprodiUserRow.nidn],
    );
    const sekprodiSig = sekprodiSigRow?.signature_image ?? null;
    const namaSekprodi = dosRow?.nama ?? "";

    // Regenerate document with sekprodi signature
    const allConfs = await conn.query(
      `SELECT recipient_role, user_id, confirmed_at
       FROM pengumpulan_berkas_final_confirmations
       WHERE pengumpulan_id = ?`,
      [pengumpulan.id],
    );
    const confirmations = allConfs[0];

    const sidangRows = await conn.query(
      `SELECT * FROM sidang WHERE skripsi_id = ? ORDER BY id DESC LIMIT 1`,
      [skripsiId],
    );
    const sidangRow = sidangRows[0][0] ?? null;

    const docBuffer = await generateSuratDoc(conn, pengumpulan, sidangRow, confirmations, sekprodiSig, namaSekprodi);

    await conn.query(
      `UPDATE pengumpulan_berkas_final_files
       SET file_content = ?, file_name = 'surat_pernyataan_penyerahan_skripsi.docx'
       WHERE pengumpulan_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYERAHAN'`,
      [docBuffer.toString("base64"), pengumpulan.id],
    );

    await conn.query(
      `UPDATE pengumpulan_berkas_final SET status = 'COMPLETED', is_completed = 1 WHERE id = ?`,
      [pengumpulan.id],
    );

    // Notify student
    const studentUserId = await getUserIdByNpm(conn, pengumpulan.npm);
    if (studentUserId) {
      await insertNotification(
        conn,
        studentUserId,
        "PENGUMPULAN_BERKAS_FINAL",
        "Surat Pernyataan Penyerahan Skripsi telah ditandatangani. Proses pengumpulan berkas final selesai.",
        `/pengumpulan-berkas-final/${skripsiId}`,
      );
    }

    await conn.commit(); txStarted = false;
    return res.json({ ok: true, data: { status: "COMPLETED", is_completed: 1 } });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// GET /pengumpulan-berkas-final/:skripsiId
exports.getPengumpulan = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const userId = Number(req.user.id);
    const userRoles = req.user.roles ?? [];

    const [[pengumpulan]] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at, sk.npm,
              s.pembimbing1_nidn, s.pembimbing2_nidn, s.penguji1_nidn, s.penguji2_nidn,
              s.program_studi_id
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       WHERE pbf.skripsi_id = ?
       LIMIT 1`,
      [skripsiId],
    );
    if (!pengumpulan) {
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }

    // Auth check
    const npm = await getStudentNpm(userId);
    const nidn = await getLecturerNidn(userId);
    const isStudent = npm && npm === pengumpulan.npm;
    const isDosen = nidn && (
      nidn === pengumpulan.pembimbing1_nidn ||
      nidn === pengumpulan.pembimbing2_nidn ||
      nidn === pengumpulan.penguji1_nidn ||
      nidn === pengumpulan.penguji2_nidn
    );
    const isPerpustakaanOrLppm = userRoles.includes("PERPUSTAKAAN_STAFF") || userRoles.includes("LPPM");
    const isSekretariatProdi = userRoles.includes("SEKPRODI");
    const isPrivileged = userRoles.includes("SEKRETARIAT") || userRoles.includes("KAPRODI");

    if (!isStudent && !isDosen && !isPerpustakaanOrLppm && !isSekretariatProdi && !isPrivileged) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [confirmations] = await db.query(
      `SELECT id, recipient_role, user_id, confirmed_at
       FROM pengumpulan_berkas_final_confirmations
       WHERE pengumpulan_id = ?
       ORDER BY FIELD(recipient_role, 'PERPUSTAKAAN','LPPM','PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2')`,
      [pengumpulan.id],
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, created_at
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type != 'SURAT_PERNYATAAN_PENYERAHAN'`,
      [pengumpulan.id],
    );

    const [[suratFile]] = await db.query(
      `SELECT id, file_name, created_at
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYERAHAN'
       LIMIT 1`,
      [pengumpulan.id],
    );

    return res.json({
      ok: true,
      data: {
        id: pengumpulan.id,
        skripsiId: pengumpulan.skripsi_id,
        npm: pengumpulan.npm,
        status: pengumpulan.status,
        isCompleted: !!pengumpulan.is_completed,
        createdAt: pengumpulan.created_at,
        updatedAt: pengumpulan.updated_at,
        confirmations: confirmations.map((c) => ({
          id: c.id,
          recipientRole: c.recipient_role,
          userId: c.user_id,
          confirmedAt: c.confirmed_at,
        })),
        files: files.map((f) => ({
          id: f.id,
          fileType: f.file_type,
          fileName: f.file_name,
          mimeType: f.mime_type,
          createdAt: f.created_at,
        })),
        suratPenyerahan: suratFile
          ? { id: suratFile.id, fileName: suratFile.file_name, createdAt: suratFile.created_at }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /pengumpulan-berkas-final/:skripsiId/files/:fileType
exports.getFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const fileType = req.params.fileType?.toUpperCase();
    const userId = Number(req.user.id);
    const userRoles = req.user.roles ?? [];

    const [[pengumpulan]] = await db.query(
      `SELECT pbf.id, sk.npm,
              s.pembimbing1_nidn, s.pembimbing2_nidn, s.penguji1_nidn, s.penguji2_nidn
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       WHERE pbf.skripsi_id = ?
       LIMIT 1`,
      [skripsiId],
    );
    if (!pengumpulan) return res.status(404).json({ ok: false, message: "Tidak ditemukan" });

    const npm = await getStudentNpm(userId);
    const nidn = await getLecturerNidn(userId);
    const isStudent = npm && npm === pengumpulan.npm;
    const isDosen = nidn && (
      nidn === pengumpulan.pembimbing1_nidn ||
      nidn === pengumpulan.pembimbing2_nidn ||
      nidn === pengumpulan.penguji1_nidn ||
      nidn === pengumpulan.penguji2_nidn
    );
    const isAuthorized = isStudent || isDosen ||
      userRoles.includes("PERPUSTAKAAN_STAFF") || userRoles.includes("LPPM") ||
      userRoles.includes("SEKPRODI") ||
      userRoles.includes("SEKRETARIAT") || userRoles.includes("KAPRODI");

    if (!isAuthorized) return res.status(403).json({ ok: false, message: "Forbidden" });

    const [[fileRow]] = await db.query(
      `SELECT file_content, file_name, mime_type
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type = ?
       LIMIT 1`,
      [pengumpulan.id, fileType],
    );
    if (!fileRow) return res.status(404).json({ ok: false, message: "File tidak ditemukan" });

    return res.json({
      ok: true,
      data: {
        fileName: fileRow.file_name,
        mimeType: fileRow.mime_type,
        fileContent: fileRow.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /lecturer/pengumpulan-berkas-final
exports.listForLecturer = async (req, res, next) => {
  try {
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) return res.status(403).json({ ok: false, message: "Forbidden" });

    const statusFilter = req.query.status;

    const callerUserId = await resolveUserId(db, nidn);
    const [rows] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at,
              m.nama as nama_mahasiswa,
              sk.judul as judul_skripsi,
              CASE
                WHEN s.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
                WHEN s.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
                WHEN s.penguji1_nidn    = ? THEN 'PENGUJI_1'
                WHEN s.penguji2_nidn    = ? THEN 'PENGUJI_2'
              END as caller_role,
              conf.confirmed_at as caller_confirmed_at
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       INNER JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengumpulan_berkas_final_confirmations conf
         ON conf.pengumpulan_id = pbf.id
         AND conf.user_id = ?
       WHERE s.pembimbing1_nidn = ?
          OR s.pembimbing2_nidn = ?
          OR s.penguji1_nidn    = ?
          OR s.penguji2_nidn    = ?
       ORDER BY pbf.created_at DESC`,
      [nidn, nidn, nidn, nidn, callerUserId ?? null, nidn, nidn, nidn, nidn],
    );

    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        callerRole: r.caller_role,
        callerConfirmedAt: r.caller_confirmed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /sekretariat-prodi/pengumpulan-berkas-final
exports.listForSekretariatProdi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const userId = Number(req.user.id);

    const [[sekprodiUserRow]] = await db.query(
      `SELECT u.nidn FROM users u WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
      [userId],
    );
    if (!sekprodiUserRow?.nidn) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[psRow]] = await db.query(
      `SELECT id FROM program_studi WHERE sekprodi_nidn = ? LIMIT 1`,
      [sekprodiUserRow.nidn],
    );
    if (!psRow) {
      return res.json({ ok: true, data: [] });
    }

    const [rows] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at,
              m.nama as nama_mahasiswa,
              sk.judul as judul_skripsi,
              (SELECT COUNT(*) FROM pengumpulan_berkas_final_confirmations c
               WHERE c.pengumpulan_id = pbf.id AND c.confirmed_at IS NOT NULL) as confirmed_count
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       INNER JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       WHERE s.program_studi_id = ?
       ORDER BY pbf.created_at DESC`,
      [psRow.id],
    );

    const statusFilter = req.query.status;
    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        confirmedCount: Number(r.confirmed_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

async function listForInstitutionRole(roleCode, recipientRole, req, res, next) {
  try {
    if (!req.user.hasRole(roleCode)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const statusFilter = req.query.status;

    const [rows] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at,
              m.nama as nama_mahasiswa,
              sk.judul as judul_skripsi,
              conf.confirmed_at as caller_confirmed_at
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       INNER JOIN pengumpulan_berkas_final_confirmations conf
         ON conf.pengumpulan_id = pbf.id AND conf.recipient_role = ?
       WHERE pbf.status != 'DRAFT'
       ORDER BY pbf.created_at DESC`,
      [recipientRole],
    );

    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        callerRole: recipientRole,
        callerConfirmedAt: r.caller_confirmed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// GET /perpustakaan/pengumpulan-berkas-final
exports.listForPerpustakaan = (req, res, next) =>
  listForInstitutionRole("PERPUSTAKAAN_STAFF", "PERPUSTAKAAN", req, res, next);

// GET /lppm/pengumpulan-berkas-final
exports.listForLppm = (req, res, next) =>
  listForInstitutionRole("LPPM", "LPPM", req, res, next);
