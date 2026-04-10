const db = require("../db");

const toBit = (v, fallback = 0) => (v === undefined ? fallback : v ? 1 : 0);

async function upsertSyarat(conn, pengajuanJudulId, syarat) {
  const [existing] = await conn.query(
    `SELECT pengajuan_judul_id
     FROM pengajuan_judul_syarat
     WHERE pengajuan_judul_id = ?
     LIMIT 1`,
    [pengajuanJudulId]
  );

  if (existing.length > 0) {
    await conn.query(
      `UPDATE pengajuan_judul_syarat
       SET
         syarat_transkrip = ?,
         syarat_krs = ?,
         syarat_metodologi_nilai_min_c = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE pengajuan_judul_id = ?`,
      [syarat.syarat_transkrip, syarat.syarat_krs, syarat.syarat_metodologi_nilai_min_c, pengajuanJudulId]
    );
    return;
  }

  await conn.query(
    `INSERT INTO pengajuan_judul_syarat (
       pengajuan_judul_id,
       syarat_transkrip,
       syarat_krs,
       syarat_metodologi_nilai_min_c
     ) VALUES (?, ?, ?, ?)`,
    [pengajuanJudulId, syarat.syarat_transkrip, syarat.syarat_krs, syarat.syarat_metodologi_nilai_min_c]
  );
}

async function upsertFileByType(conn, pengajuanJudulId, fileType, fileContent, fileName) {
  await conn.query(
    `DELETE FROM pengajuan_judul_file
     WHERE pengajuan_judul_id = ? AND file_type = ?`,
    [pengajuanJudulId, fileType]
  );

  await conn.query(
    `INSERT INTO pengajuan_judul_file (
       pengajuan_judul_id, file_type, file_content, file_name
     ) VALUES (?, ?, ?, ?)`,
    [pengajuanJudulId, fileType, fileContent, fileName]
  );
}

exports.listForKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only Kaprodi" });
    }

    // Ambil nidn dosen dari user
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const nidn = urows[0]?.nidn;
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const [rows] = await db.query(
      `
      SELECT
        pj.id,
        pj.status,
        pj.submitted_at,
        pj.created_at,
        o.judul AS outline_judul,
        m.npm,
        m.nama AS nama_mahasiswa,
        ps.nama AS program_studi
      FROM pengajuan_judul pj
      INNER JOIN outline o ON o.id = pj.outline_id
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE ps.kaprodi_nidn = ?
      ORDER BY pj.submitted_at DESC
      `,
      [nidn]
    );

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      const [fileRows] = await db.query(
        `SELECT pengajuan_judul_id, file_content, file_name
         FROM pengajuan_judul_file
         WHERE file_type = 'PENGAJUAN_JUDUL'
           AND pengajuan_judul_id IN (?)`,
        [ids]
      );
      const fileMap = new Map();
      for (const fr of fileRows) {
        fileMap.set(fr.pengajuan_judul_id, {
          file_pengajuan_judul: fr.file_content ?? null,
          file_pengajuan_judul_name: fr.file_name ?? null,
        });
      }
      for (const row of rows) {
        const fileData = fileMap.get(row.id) || {};
        row.file_pengajuan_judul = fileData.file_pengajuan_judul ?? null;
        row.file_pengajuan_judul_name = fileData.file_pengajuan_judul_name ?? null;
      }
    }

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.review = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only Kaprodi" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const {
      status,
      pembimbing1DitapkanNidn,
      pembimbing2DitapkanNidn,
      catatanKaprodi,
      filePengajuanJudul,
      filePengajuanJudulName,
      syaratTranskrip,
      syaratKrs,
      syaratMetodologi,
    } = req.body || {};

    if (!["APPROVED", "NEED_REVISION", "REJECTED"].includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    console.log("Test");

    if (
      status === "APPROVED" &&
      (!pembimbing2DitapkanNidn || String(pembimbing2DitapkanNidn).trim().length === 0)
    ) {
      console.log("Test2");
      return res.status(400).json({
        ok: false,
        message: "pembimbing2DitapkanNidn is required for APPROVED status",
      });
    }

    if (
      status === "NEED_REVISION" &&
      (!catatanKaprodi || String(catatanKaprodi).trim().length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "catatanKaprodi is required for NEED_REVISION",
      });
    }

    // Ambil nidn Kaprodi
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const kaprodiNidn = urows[0]?.nidn;
    if (!kaprodiNidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    // Pastikan pengajuan ini memang milik prodinya Kaprodi
    const [check] = await db.query(
      `
      SELECT pj.id
      FROM pengajuan_judul pj
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE pj.id = ?
        AND ps.kaprodi_nidn = ?
        AND pj.status = 'SUBMITTED'
      LIMIT 1
      `,
      [id, kaprodiNidn]
    );

    if (check.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan tidak ditemukan / bukan wewenang Anda",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    let consultationInitialized = false;

    await conn.query(
      `
      UPDATE pengajuan_judul
      SET
        status = ?,
        pembimbing1_ditetapkan_nidn = ?,
        pembimbing2_ditetapkan_nidn = ?,
        catatan_kaprodi = ?,
        disposisi_at = CURRENT_TIMESTAMP,
        decided_by_user_id = ?
      WHERE id = ?
      `,
      [
        status,
        pembimbing1DitapkanNidn ?? null,
        pembimbing2DitapkanNidn ?? null,
        catatanKaprodi ?? null,
        req.user.id,
        id,
      ]
    );

    if (status === "APPROVED") {
      console.log("Test3");
      const [kartuRows] = await conn.query(
        `SELECT id
         FROM kartu_konsultasi_outline
         WHERE pengajuan_judul_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (kartuRows.length === 0) {
        const [snapshotRows] = await conn.query(
          `SELECT
             pj.id AS pengajuan_judul_id,
             pj.npm,
             pj.program_studi_id,
             pj.pembimbing1_ditetapkan_nidn,
             pj.pembimbing2_ditetapkan_nidn,
             o.judul AS judul_skripsi,
             m.nama AS nama_mahasiswa,
             ps.nama AS program_studi_nama,
             d1.nama AS pembimbing1_nama,
             d2.nama AS pembimbing2_nama
           FROM pengajuan_judul pj
           INNER JOIN outline o ON o.id = pj.outline_id
           INNER JOIN mahasiswa m ON m.npm = pj.npm
           LEFT JOIN program_studi ps ON ps.id = pj.program_studi_id
           LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_ditetapkan_nidn
           LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_ditetapkan_nidn
           WHERE pj.id = ?
           LIMIT 1`,
          [id]
        );
        const snap = snapshotRows[0] || null;

        if (!snap) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Failed to resolve snapshot data for consultation initialization",
          });
        }
        if (!snap.program_studi_id) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Missing required snapshot data: program_studi_id",
          });
        }
        if (!snap.program_studi_nama || String(snap.program_studi_nama).trim().length === 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Missing required snapshot data: program_studi_nama",
          });
        }
        if (!snap.judul_skripsi || String(snap.judul_skripsi).trim().length === 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Missing required snapshot data: judul_skripsi",
          });
        }
        if (!snap.nama_mahasiswa || String(snap.nama_mahasiswa).trim().length === 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Missing required snapshot data: nama_mahasiswa",
          });
        }
        if (
          !snap.pembimbing2_ditetapkan_nidn ||
          String(snap.pembimbing2_ditetapkan_nidn).trim().length === 0
        ) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Missing required snapshot data: pembimbing2_ditetapkan_nidn",
          });
        }

        const [insKartu] = await conn.query(
          `INSERT INTO kartu_konsultasi_outline (
             pengajuan_judul_id,
             nama_mahasiswa,
             npm,
             program_studi_id,
             program_studi_nama,
             judul_skripsi,
             pembimbing1_nidn,
             pembimbing1_nama,
             pembimbing2_nidn,
             pembimbing2_nama,
             is_completed
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            snap.pengajuan_judul_id,
            String(snap.nama_mahasiswa).trim(),
            snap.npm,
            snap.program_studi_id,
            String(snap.program_studi_nama).trim(),
            String(snap.judul_skripsi).trim(),
            snap.pembimbing1_ditetapkan_nidn ?? null,
            snap.pembimbing1_nama ?? null,
            String(snap.pembimbing2_ditetapkan_nidn).trim(),
            snap.pembimbing2_nama ?? null,
          ]
        );

        await conn.query(
          `INSERT INTO konsultasi_outline_stage (
             kartu_konsultasi_outline_id,
             pengajuan_judul_id,
             stage,
             pembimbing_nidn,
             current_status,
             current_submission_no,
             started_at
           ) VALUES (?, ?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [insKartu.insertId, snap.pengajuan_judul_id, String(snap.pembimbing2_ditetapkan_nidn).trim()]
        );

        consultationInitialized = true;
      }
    }

    if (syaratTranskrip !== undefined || syaratKrs !== undefined || syaratMetodologi !== undefined) {
      const [currentSyaratRows] = await conn.query(
        `SELECT
           syarat_transkrip,
           syarat_krs,
           syarat_metodologi_nilai_min_c
         FROM pengajuan_judul_syarat
         WHERE pengajuan_judul_id = ?
         LIMIT 1`,
        [id]
      );
      const currentSyarat = currentSyaratRows[0] || {};
      await upsertSyarat(conn, id, {
        syarat_transkrip: toBit(syaratTranskrip, currentSyarat.syarat_transkrip ?? 0),
        syarat_krs: toBit(syaratKrs, currentSyarat.syarat_krs ?? 0),
        syarat_metodologi_nilai_min_c: toBit(
          syaratMetodologi,
          currentSyarat.syarat_metodologi_nilai_min_c ?? 0
        ),
      });
    }

    if (filePengajuanJudul !== undefined && filePengajuanJudul !== null) {
      await upsertFileByType(
        conn,
        id,
        "PENGAJUAN_JUDUL",
        String(filePengajuanJudul),
        filePengajuanJudulName !== undefined && filePengajuanJudulName !== null
          ? String(filePengajuanJudulName).trim()
          : null
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: consultationInitialized ? "Review saved and consultation initialized" : "Review saved",
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};
