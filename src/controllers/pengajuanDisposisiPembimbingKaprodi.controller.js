const db = require("../db");
const { insertNotification } = require("../utils/notify");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");

const toBit = (v, fallback = 0) => (v === undefined ? fallback : v ? 1 : 0);

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatDateId(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function checkbox(value) {
  return value ? "☑" : "☐";
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (signatureValue == null) return null;
  const raw = String(signatureValue).trim();
  if (!raw) return null;
  const dataUrlMatch = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    try {
      const mimeType = dataUrlMatch[1].toLowerCase();
      const type = mimeType === "jpeg" ? "jpg" : mimeType;
      return { buffer: Buffer.from(dataUrlMatch[2], "base64"), type };
    } catch (_) { return null; }
  }
  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 = /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      const buffer = Buffer.from(normalized, "base64");
      const type = buffer[0] === 0x89 && buffer[1] === 0x50 ? "png" : "jpg";
      return { buffer, type };
    } catch (_) { return null; }
  }
  return null;
}

function signatureImagePatch(signatureValue) {
  const decoded = decodeSignatureToBuffer(signatureValue);
  if (!decoded || decoded.buffer.length === 0) return textPatch("");
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [new ImageRun({ type: decoded.type, data: decoded.buffer, transformation: { width: 160, height: 60 } })],
    };
  } catch (_) { return textPatch(""); }
}

async function generateFormulirDoc(data) {
  const {
    npm, namaMahasiswa, programStudiNama, noHp, sks, judulSkripsi,
    pembimbing1DiajukanNama, pembimbing2DiajukanNama,
    perluSuratPengantar, namaPerusahaan, studentSignature, submittedAt,
    programStudiNamaUpper, disposisiDate, keputusan,
    dosenPembimbing1, dosenPembimbing2, catatan,
    syaratTranskrip, syaratKrs, syaratMetodologi,
    namaKaprodi, kaprodiSignature,
  } = data;

  const templateBuffer = await readFile(
    path.join(__dirname, "../templates/template_formulir_pengajuan_disposisi_pembimbing_skripsi.docx"),
  );

  const patches = {
    npm: textPatch(npm ?? ""),
    nama_mahasiswa: textPatch(namaMahasiswa ?? ""),
    nama: textPatch(namaMahasiswa ?? ""),
    program_studi: textPatch(programStudiNama ?? ""),
    no_hp: textPatch(noHp ?? ""),
    sks: textPatch(String(sks ?? "")),
    judul: textPatch(judulSkripsi ?? ""),
    calon_dosen_pembimbing_1: textPatch(pembimbing1DiajukanNama ?? ""),
    calon_dosen_pembimbing_2: textPatch(pembimbing2DiajukanNama ?? ""),
    perlu_surat_pengantar: textPatch(
      perluSuratPengantar ? "☑ Ya    ☐ Tidak" : "☐ Ya    ☑ Tidak"
    ),
    nama_perusahaan: textPatch(namaPerusahaan || "-"),
    today_date: textPatch(formatDateId(submittedAt ?? new Date())),
    signature: signatureImagePatch(studentSignature),
    nama_program_studi: textPatch(
      programStudiNamaUpper ?? (programStudiNama ? String(programStudiNama).toUpperCase() : "")
    ),
    disposisi_date: textPatch(disposisiDate ? formatDateId(disposisiDate) : ""),
    keputusan: textPatch(keputusan ?? ""),
    dosen_pembimbing_1: textPatch(dosenPembimbing1 ?? ""),
    dosen_pembimbing_2: textPatch(dosenPembimbing2 ?? ""),
    catatan: textPatch(catatan || "-"),
    syarat_transkrip: textPatch(checkbox(syaratTranskrip)),
    syarat_krs: textPatch(checkbox(syaratKrs)),
    syarat_metodologi: textPatch(checkbox(syaratMetodologi)),
    nama_kaprodi: textPatch(namaKaprodi ?? ""),
    kaprodi_signature: signatureImagePatch(kaprodiSignature),
  };

  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer.toString("base64");
}


async function upsertFileByType(
  conn,
  pengajuanDisposisiPembimbingId,
  fileType,
  fileContent,
  fileName,
) {
  await conn.query(
    `DELETE FROM pengajuan_disposisi_pembimbing_file
     WHERE pengajuan_disposisi_pembimbing_id = ? AND file_type = ?`,
    [pengajuanDisposisiPembimbingId, fileType],
  );

  console.log("[upsertFileByType] INSERT params:", {
    table: "pengajuan_disposisi_pembimbing_file",
    pengajuan_disposisi_pembimbing_id: pengajuanDisposisiPembimbingId,
    file_type: fileType,
    file_name: fileName,
    file_content_length: fileContent?.length,
  });
  await conn.query(
    `INSERT INTO pengajuan_disposisi_pembimbing_file (
       pengajuan_disposisi_pembimbing_id, file_type, file_content, file_name
     ) VALUES (?, ?, ?, ?)`,
    [pengajuanDisposisiPembimbingId, fileType, fileContent, fileName],
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
      [req.user.id],
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
        m.sks AS mahasiswa_sks,
        ps.nama AS program_studi
      FROM pengajuan_disposisi_pembimbing pj
      INNER JOIN outline o ON o.id = pj.outline_id
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE ps.kaprodi_nidn = ?
      ORDER BY pj.submitted_at DESC
      `,
      [nidn],
    );

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      const [fileRows] = await db.query(
        `SELECT pengajuan_disposisi_pembimbing_id, file_content, file_name
         FROM pengajuan_disposisi_pembimbing_file
         WHERE file_type = 'PENGAJUAN_DISPOSISI_PEMBIMBING'
           AND pengajuan_disposisi_pembimbing_id IN (?)`,
        [ids],
      );
      const fileMap = new Map();
      for (const fr of fileRows) {
        fileMap.set(fr.pengajuan_disposisi_pembimbing_id, {
          file_pengajuan_disposisi_pembimbing: fr.file_content ?? null,
          file_pengajuan_disposisi_pembimbing_name: fr.file_name ?? null,
        });
      }
      for (const row of rows) {
        const fileData = fileMap.get(row.id) || {};
        row.file_pengajuan_disposisi_pembimbing = fileData.file_pengajuan_disposisi_pembimbing ?? null;
        row.file_pengajuan_disposisi_pembimbing_name =
          fileData.file_pengajuan_disposisi_pembimbing_name ?? null;
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
    console.log("[review] START — params:", req.params, "body:", { ...req.body, fileContent: undefined });

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
      syaratTranskrip,
      syaratKrs,
      syaratMetodologi,
    } = req.body || {};

    console.log("[review] parsed body:", { status, pembimbing1DitapkanNidn, pembimbing2DitapkanNidn, catatanKaprodi, syaratTranskrip, syaratKrs, syaratMetodologi });

    if (!["APPROVED", "NEED_REVISION", "REJECTED"].includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    if (
      status === "APPROVED" &&
      (!pembimbing2DitapkanNidn ||
        String(pembimbing2DitapkanNidn).trim().length === 0)
    ) {
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
      [req.user.id],
    );
    const kaprodiNidn = urows[0]?.nidn;
    console.log("[review] kaprodiNidn:", kaprodiNidn);
    if (!kaprodiNidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    // Pastikan pengajuan ini memang milik prodinya Kaprodi
    const [check] = await db.query(
      `
      SELECT pj.id, pj.syarat_transkrip, pj.syarat_krs, pj.syarat_metodologi_nilai_min_c
      FROM pengajuan_disposisi_pembimbing pj
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE pj.id = ?
        AND ps.kaprodi_nidn = ?
        AND pj.status = 'SUBMITTED'
      LIMIT 1
      `,
      [id, kaprodiNidn],
    );
    console.log("[review] ownership check rows:", check.length);

    if (check.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan tidak ditemukan / bukan wewenang Anda",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;
    console.log("[review] transaction started");

    let consultationInitialized = false;

    console.log("[review] UPDATE pengajuan_disposisi_pembimbing id:", id, "status:", status);
    await conn.query(
      `
      UPDATE pengajuan_disposisi_pembimbing
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
      ],
    );
    console.log("[review] UPDATE done");

    if (status === "APPROVED") {
      console.log("[review] APPROVED branch — fetching snapshot");
      const [snapshotRows] = await conn.query(
        `SELECT
           pj.id AS pengajuan_disposisi_pembimbing_id,
           pj.outline_id,
           pj.npm,
           pj.program_studi_id,
           pj.pembimbing1_ditetapkan_nidn,
           pj.pembimbing2_ditetapkan_nidn,
           o.judul AS judul_skripsi,
           m.nama AS nama_mahasiswa,
           ps.nama AS program_studi_nama,
           d1.nama AS pembimbing1_nama,
           d2.nama AS pembimbing2_nama
         FROM pengajuan_disposisi_pembimbing pj
         INNER JOIN outline o ON o.id = pj.outline_id
         INNER JOIN mahasiswa m ON m.npm = pj.npm
         LEFT JOIN program_studi ps ON ps.id = pj.program_studi_id
         LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_ditetapkan_nidn
         LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_ditetapkan_nidn
         WHERE pj.id = ?
         LIMIT 1`,
        [id],
      );
      const snap = snapshotRows[0] || null;
      console.log("[review] snapshot:", snap ? { ...snap } : null);

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
      if (!snap.pembimbing2_ditetapkan_nidn || String(snap.pembimbing2_ditetapkan_nidn).trim().length === 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Missing required snapshot data: pembimbing2_ditetapkan_nidn",
        });
      }

      console.log("[review] UPDATE outline id:", snap.outline_id);
      await conn.query(
        `UPDATE outline SET
           pembimbing1_nidn = ?,
           pembimbing2_nidn = ?,
           approved_at      = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          snap.pembimbing1_ditetapkan_nidn ?? null,
          String(snap.pembimbing2_ditetapkan_nidn).trim(),
          snap.outline_id,
        ],
      );
      console.log("[review] outline updated");

      const [kartuRows] = await conn.query(
        `SELECT id FROM kartu_konsultasi_outline WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
        [snap.outline_id],
      );
      console.log("[review] existing kartu rows:", kartuRows.length);

      if (kartuRows.length === 0) {
        console.log("[review] INSERT kartu_konsultasi_outline — outline_id:", snap.outline_id);
        const [insKartu] = await conn.query(
          `INSERT INTO kartu_konsultasi_outline (outline_id, is_completed) VALUES (?, 0)`,
          [snap.outline_id],
        );
        console.log("[review] kartu_konsultasi_outline insertId:", insKartu.insertId);

        await conn.query(
          `INSERT INTO konsultasi_outline_stage (
             kartu_konsultasi_outline_id,
             stage,
             pembimbing_nidn,
             current_status,
             current_submission_no,
             started_at
           ) VALUES (?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [
            insKartu.insertId,
            String(snap.pembimbing2_ditetapkan_nidn).trim(),
          ],
        );
        console.log("[review] konsultasi_outline_stage inserted");

        consultationInitialized = true;
      }
    }

    if (
      syaratTranskrip !== undefined ||
      syaratKrs !== undefined ||
      syaratMetodologi !== undefined
    ) {
      console.log("[review] updating syarat");
      const currentRow = check[0];
      await conn.query(
        `UPDATE pengajuan_disposisi_pembimbing
         SET syarat_transkrip = ?, syarat_krs = ?, syarat_metodologi_nilai_min_c = ?
         WHERE id = ?`,
        [
          toBit(syaratTranskrip, currentRow.syarat_transkrip ?? 0),
          toBit(syaratKrs, currentRow.syarat_krs ?? 0),
          toBit(syaratMetodologi, currentRow.syarat_metodologi_nilai_min_c ?? 0),
          id,
        ],
      );
      console.log("[review] syarat updated");
    }

    console.log("[review] fetching reviewDocRows");
    const [reviewDocRows] = await conn.query(
      `SELECT
         pj.npm, pj.no_hp, pj.perlu_surat_pengantar, pj.nama_perusahaan,
         pj.submitted_at,
         pj.syarat_transkrip, pj.syarat_krs, pj.syarat_metodologi_nilai_min_c,
         m.nama AS nama_mahasiswa, m.sks AS mahasiswa_sks,
         ps.nama AS program_studi_nama, ps.kaprodi_nidn,
         o.judul AS judul_skripsi,
         d1.nama AS pembimbing1_diajukan_nama,
         d2.nama AS pembimbing2_diajukan_nama,
         d3.nama AS pembimbing1_ditetapkan_nama,
         d4.nama AS pembimbing2_ditetapkan_nama,
         u_student.signature_image AS student_signature,
         dkap.nama AS kaprodi_nama,
         u_kaprodi.signature_image AS kaprodi_signature
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       JOIN program_studi ps ON ps.id = pj.program_studi_id
       JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn
       LEFT JOIN users u_student ON u_student.npm = pj.npm AND u_student.is_active = 1
       LEFT JOIN dosen dkap ON dkap.nidn = ps.kaprodi_nidn
       LEFT JOIN users u_kaprodi ON u_kaprodi.nidn = ps.kaprodi_nidn AND u_kaprodi.is_active = 1
       WHERE pj.id = ?
       LIMIT 1`,
      [id],
    );
    const rd = reviewDocRows[0] ?? {};
    console.log("[review] reviewDocRows[0] keys:", Object.keys(rd));

    const keputusanMap = { APPROVED: "Diterima", NEED_REVISION: "Perlu Revisi", REJECTED: "Ditolak" };

    console.log("[review] generating formulir doc");
    const reviewFormulirBase64 = await generateFormulirDoc({
      npm: rd.npm,
      namaMahasiswa: rd.nama_mahasiswa,
      programStudiNama: rd.program_studi_nama,
      noHp: rd.no_hp,
      sks: rd.mahasiswa_sks,
      judulSkripsi: rd.judul_skripsi,
      pembimbing1DiajukanNama: rd.pembimbing1_diajukan_nama ?? "",
      pembimbing2DiajukanNama: rd.pembimbing2_diajukan_nama ?? "",
      perluSuratPengantar: Boolean(rd.perlu_surat_pengantar),
      namaPerusahaan: rd.nama_perusahaan ?? null,
      studentSignature: rd.student_signature,
      submittedAt: rd.submitted_at ? new Date(rd.submitted_at) : new Date(),
      programStudiNamaUpper: rd.program_studi_nama ? String(rd.program_studi_nama).toUpperCase() : "",
      disposisiDate: new Date(),
      keputusan: keputusanMap[status] ?? status,
      dosenPembimbing1: rd.pembimbing1_ditetapkan_nama ?? "",
      dosenPembimbing2: rd.pembimbing2_ditetapkan_nama ?? "",
      catatan: catatanKaprodi ?? null,
      syaratTranskrip: Boolean(rd.syarat_transkrip),
      syaratKrs: Boolean(rd.syarat_krs),
      syaratMetodologi: Boolean(rd.syarat_metodologi_nilai_min_c),
      namaKaprodi: rd.kaprodi_nama ?? "",
      kaprodiSignature: rd.kaprodi_signature,
    });
    console.log("[review] formulir doc generated, length:", reviewFormulirBase64?.length);

    console.log("[review] calling upsertFileByType — pengajuanId:", id);
    await upsertFileByType(
      conn,
      id,
      "PENGAJUAN_DISPOSISI_PEMBIMBING",
      reviewFormulirBase64,
      "formulir_pengajuan_disposisi_pembimbing_skripsi.docx",
    );
    console.log("[review] upsertFileByType done");

    const [reviewedRows] = await conn.query(
      `SELECT pj.npm, m.nama AS nama_mahasiswa,
              pj.pembimbing1_ditetapkan_nidn, pj.pembimbing2_ditetapkan_nidn
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       WHERE pj.id = ? LIMIT 1`,
      [id],
    );
    const reviewed = reviewedRows[0];
    console.log("[review] reviewed row:", reviewed ? { npm: reviewed.npm, nama_mahasiswa: reviewed.nama_mahasiswa } : null);
    if (reviewed) {
      const [studentUserRows] = await conn.query(
        `SELECT id FROM users WHERE npm = ? LIMIT 1`,
        [reviewed.npm],
      );
      const studentUserId = studentUserRows[0]?.id ?? null;
      console.log("[review] studentUserId:", studentUserId);
      if (studentUserId) {
        const typeMap = {
          NEED_REVISION: "TITLE_NEED_REVISION",
          REJECTED: "TITLE_REJECTED",
          APPROVED: "TITLE_APPROVED",
        };
        const msgMap = {
          NEED_REVISION: "Pengajuan disposisi pembimbing Anda memerlukan revisi",
          REJECTED: "Pengajuan disposisi pembimbing Anda ditolak",
          APPROVED: "Pengajuan disposisi pembimbing Anda disetujui",
        };
        await insertNotification(
          conn,
          studentUserId,
          typeMap[status],
          msgMap[status],
          "/student/proposal",
        );
        console.log("[review] student notification inserted");
      }

      if (status === "APPROVED") {
        const assignMsg = `Anda ditugaskan sebagai pembimbing skripsi untuk ${reviewed.nama_mahasiswa}`;
        for (const nidn of [
          reviewed.pembimbing1_ditetapkan_nidn,
          reviewed.pembimbing2_ditetapkan_nidn,
        ]) {
          if (!nidn) continue;
          console.log("[review] inserting pembimbing notification for nidn:", nidn);
          const [pUserRows] = await conn.query(
            `SELECT u.id FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.nidn = ? AND r.code = 'PEMBIMBING'
             LIMIT 1`,
            [nidn],
          );
          if (pUserRows[0]?.id) {
            await insertNotification(
              conn,
              pUserRows[0].id,
              "ASSIGNED_AS_PEMBIMBING",
              assignMsg,
              "/lecturer/outline-consultations",
            );
          }
        }
      }
    }

    await conn.commit();
    txStarted = false;
    console.log("[review] committed — done");

    return res.json({
      ok: true,
      message: consultationInitialized
        ? "Review saved and consultation initialized"
        : "Review saved",
    });
  } catch (err) {
    console.error("[review] ERROR:", err.message, err.stack);
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
