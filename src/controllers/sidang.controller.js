const db = require("../db");
const path = require("path");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const {
  generateKomponenPenilaianUjianSkripsiKomprehensifFTI,
} = require("../services/generateKomponenPenilaianUjianSkripsiKomprehensifFTI");
const {
  generateHasilPenilaianAkhirUjianSkripsiFTI,
} = require("../services/generateHasilPenilaianAkhirUjianSkripsiFTI");
const {
  generateNotulenPengujiFTI,
} = require("../services/generateNotulenPengujiFTI");
const {
  generateBeritaAcaraHasilUjianSkripsiKomprehensifFTI,
} = require("../services/generateBeritaAcaraHasilUjianSkripsiKomprehensifFTI");
const {
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const { assertSignatures } = require("../utils/signature");
const { formatTanggal } = require("../utils/dates");
const {
  generateKomponenPenilaianSeminarProposalFTI,
} = require("../services/generateKomponenPenilaianSeminarProposalFTI");
const {
  generateHasilPenilaianAkhirSeminarProposalFTI,
} = require("../services/generateHasilPenilaianAkhirSeminarProposalFTI");
const {
  generateNotulenSeminarProposalFTI,
} = require("../services/generateNotulenSeminarProposalFTI");
const {
  generateBeritaAcaraHasilSeminarProposalFTI,
} = require("../services/generateBeritaAcaraHasilSeminarProposalFTI");
const {
  JENIS,
  requireJenis,
  resolveJenis,
  resolveReadJenis,
  getLatestSidang,
} = require("../services/sidangScope.service");

// A Seminar Bisnis Digital sidang ("Seminar Proposal") has one penguji, so 3 penilaian and 1
// notulen, and its verdict is JUDUL_DITERIMA / JUDUL_DITOLAK instead of the Skripsi verdicts.
function isSeminarSidang(sidang) {
  return sidang.jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
}

function sidangLabel(sidang) {
  return isSeminarSidang(sidang) ? "seminar proposal" : "sidang skripsi";
}

function notulenRolesFor(sidang) {
  return isSeminarSidang(sidang) ? ["PENGUJI_1"] : ["PENGUJI_1", "PENGUJI_2"];
}

const HASIL_SIDANG_BY_JENIS = {
  [JENIS.SKRIPSI]: ["LULUS", "TIDAK_LULUS", "GAGAL"],
  [JENIS.SEMINAR_BISNIS_DIGITAL]: ["JUDUL_DITERIMA", "JUDUL_DITOLAK"],
};

const HASIL_SEMINAR_LABEL = {
  JUDUL_DITERIMA: "Diterima",
  JUDUL_DITOLAK: "Tidak Diterima",
};

const MIME_PDF = "application/pdf";

const HARI_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function formatHari(date) {
  return HARI_ID[date.getDay()];
}

async function resolveUserId(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE COALESCE(nidn, staff_usr_id) = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    [nidn],
  );
  return row?.id ?? null;
}

function resolveSidangRole(sidangRow, nidn) {
  if (!nidn) return null;
  if (sidangRow.pembimbing1_nidn === nidn) return "PEMBIMBING_1";
  if (sidangRow.pembimbing2_nidn === nidn) return "PEMBIMBING_2";
  if (sidangRow.penguji1_nidn === nidn) return "PENGUJI_1";
  if (sidangRow.penguji2_nidn === nidn) return "PENGUJI_2";
  return null;
}

function computeGrade(rata) {
  if (rata >= 80) return "A";
  if (rata >= 70) return "B";
  if (rata >= 60) return "C";
  return "D";
}

const ROLE_LABEL = {
  PEMBIMBING_1: "Pembimbing Pertama",
  PEMBIMBING_2: "Pembimbing Kedua",
  PENGUJI_1: "Penguji Pertama",
  PENGUJI_2: "Penguji Kedua",
};

const BOBOT = {
  isi: 0.3,
  bahasa: 0.15,
  tsp: 0.05,
  penguasaan: 0.4,
  penunjang: 0.1,
};

// Max points per komponen = bobot * 100. Lecturers enter already-weighted
// points directly (e.g. Isi max 30), not a raw 0-100 score to be multiplied.
const NILAI_MAX = {
  isi: BOBOT.isi * 100,
  bahasa: BOBOT.bahasa * 100,
  tsp: BOBOT.tsp * 100,
  penguasaan: BOBOT.penguasaan * 100,
  penunjang: BOBOT.penunjang * 100,
};
const NILAI_KEYS = ["isi", "bahasa", "tsp", "penguasaan", "penunjang"];

const NOTULEN_ROLE_LABEL = {
  PENGUJI_1: "Penguji Utama",
  PENGUJI_2: "Anggota Penguji",
};

async function getSidangBySkripsiId(conn, skripsiId, jenis) {
  const [[sidang]] = await conn.query(
    `SELECT
       s.id, s.skripsi_id, s.jenis, s.pengajuan_sidang_id, s.nomor_surat,
       m.nama AS nama_mahasiswa, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
       psk_k.tanggal_disposisi, s.status, s.hasil_sidang, s.catatan_penguji, s.judul_baru,
       s.created_at, s.updated_at, s.completed_at,
       ps.ujian_ke,
       m.npm,
       prog.id   AS program_studi_id,
       prog.nama AS program_studi_nama,
       sk.judul  AS judul_skripsi,
       sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
       sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
       psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
       psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama
     FROM sidang s
     LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
     JOIN skripsi sk ON sk.id = s.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     JOIN program_studi prog ON prog.id = sk.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
     LEFT JOIN pengajuan_sidang_kaprodi psk_k
            ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
     LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
     LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
     WHERE s.skripsi_id = ? AND s.jenis = ? ORDER BY s.id DESC LIMIT 1`,
    [skripsiId, requireJenis(jenis)],
  );
  return sidang ?? null;
}

// Serializes notulen, penilaian and hasil-penilaian writes on one sidang, so two pembimbing
// submitting hasil at once, or a penilaian edited while hasil is computing, can't interleave.
// Must run before the transaction's first plain read: the snapshot is taken at that read, so a
// waiter then sees the status the lock holder committed (e.g. COMPLETED → clean 409). That is
// also why callers resolve jenis before beginTransaction().
async function lockLatestSidang(conn, skripsiId, jenis) {
  await getLatestSidang(conn, skripsiId, jenis, { forUpdate: true });
}

// The four file downloads share this lookup: identity and participant NIDNs for the access check.
// ?jenis= reads a finished phase (the Seminar documents after the record moved on to Skripsi).
async function getSidangForFileAccess(skripsiId, requestedJenis) {
  const jenis = await resolveReadJenis(db, skripsiId, requestedJenis);
  const [[sidang]] = await db.query(
    `SELECT s.id, s.skripsi_id, s.pengajuan_sidang_id, s.status,
            m.npm, m.nama AS nama_mahasiswa, sk.program_studi_id,
            sk.pembimbing1_nidn, sk.pembimbing2_nidn,
            psk_k.penguji1_nidn, psk_k.penguji2_nidn
     FROM sidang s
     JOIN skripsi sk ON sk.id = s.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     LEFT JOIN pengajuan_sidang_kaprodi psk_k
            ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
     WHERE s.skripsi_id = ? AND s.jenis = ? ORDER BY s.id DESC LIMIT 1`,
    [skripsiId, jenis],
  );
  return sidang ?? null;
}

// GET /sidang/:skripsiId
exports.getSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const sidang = await getSidangBySkripsiId(
      db,
      skripsiId,
      await resolveReadJenis(db, skripsiId, req.query?.jenis),
    );
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    // Authorization: student must own this pengajuan_disposisi_pembimbing; dosen must be one of the 4 participants
    const isStudent = req.user.hasRole("STUDENT");
    const isSekretatariat = req.user.hasRole("SEKRETARIAT");
    const isKaprodi = req.user.hasRole("KAPRODI");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== sidang.npm) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (isKaprodi && !isSekretatariat) {
      if (!(await isKaprodiOfProgramStudi(req.user.id, sidang.program_studi_id))) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (!isSekretatariat) {
      const nidn = await getLecturerNidn(req.user.id);
      const role = resolveSidangRole(sidang, nidn);
      if (!role) {
        return res
          .status(403)
          .json({ ok: false, message: "Anda bukan peserta sidang ini" });
      }
    }

    // file_content (the generated PDFs) is deliberately not selected: downloads go through /files/*.
    const [penilaianRows] = await db.query(
      `SELECT id, sidang_id, user_id, role,
              nilai_isi, keterangan_isi, nilai_bahasa, keterangan_bahasa,
              nilai_tsp, keterangan_tsp, nilai_penguasaan, keterangan_penguasaan,
              nilai_penunjang, keterangan_penunjang, total_nilai,
              file_name, submitted_at, created_at, updated_at
       FROM sidang_penilaian WHERE sidang_id = ? ORDER BY FIELD(role,'PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2')`,
      [sidang.id],
    );

    const [notulenRows] = await db.query(
      `SELECT id, sidang_id, user_id, role, note, hasil_sidang,
              file_name, submitted_at, created_at, updated_at
       FROM sidang_notulen WHERE sidang_id = ? ORDER BY FIELD(role,'PENGUJI_1','PENGUJI_2')`,
      [sidang.id],
    );

    const [[hasilPenilaian]] = await db.query(
      `SELECT id, sidang_id, nilai_pembimbing1, nilai_pembimbing2,
              nilai_penguji1, nilai_penguji2, total_nilai, rata, grade,
              hasil_sidang, catatan_penguji,
              file_name, submitted_at, created_at, updated_at
       FROM sidang_hasil_penilaian WHERE sidang_id = ? LIMIT 1`,
      [sidang.id],
    );

    const [files] = await db.query(
      `SELECT id, file_name, created_at FROM sidang_files WHERE sidang_id = ?`,
      [sidang.id],
    );

    // Determine caller's role for visibility
    let callerRole = null;
    if (!isStudent && !isSekretatariat && !isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      callerRole = resolveSidangRole(sidang, nidn);
    }

    const isOngoing = sidang.status !== "COMPLETED";

    // Mahasiswa never see scores, only the outcome via sidang.hasil_sidang
    const sanitizePenilaian = (row) => {
      if (!isStudent) return row;
      const {
        nilai_isi,
        keterangan_isi,
        nilai_bahasa,
        keterangan_bahasa,
        nilai_tsp,
        keterangan_tsp,
        nilai_penguasaan,
        keterangan_penguasaan,
        nilai_penunjang,
        keterangan_penunjang,
        total_nilai,
        file_content,
        file_name,
        submitted_at,
        ...safe
      } = row;
      return safe;
    };

    // For lecturers during ONGOING: hide other participants' scores and file_content but keep submitted_at
    // Pembimbing 1 and Pembimbing 2 see all scores (either can submit hasil penilaian akhir)
    const sanitizePenilaianForLecturer = (row) => {
      if (
        !isOngoing ||
        !callerRole ||
        callerRole === "PEMBIMBING_1" ||
        callerRole === "PEMBIMBING_2"
      )
        return row;
      if (row.role === callerRole) {
        const { file_content, ...safe } = row;
        return safe;
      }
      const {
        nilai_isi,
        keterangan_isi,
        nilai_bahasa,
        keterangan_bahasa,
        nilai_tsp,
        keterangan_tsp,
        nilai_penguasaan,
        keterangan_penguasaan,
        nilai_penunjang,
        keterangan_penunjang,
        total_nilai,
        file_content,
        file_name,
        ...safe
      } = row;
      return safe;
    };

    const sanitizedPenilaian = penilaianRows.map(
      isStudent ? sanitizePenilaian : sanitizePenilaianForLecturer,
    );

    // Notulen: hide note + file_content from non-owners during ONGOING
    const sanitizedNotulen = notulenRows.map((row) => {
      const hasSubmitted = row.submitted_at !== null;
      if (!isOngoing) return { ...row, has_submitted: hasSubmitted };
      if (isStudent) {
        const {
          note,
          hasil_sidang,
          file_content,
          file_name,
          submitted_at,
          ...safe
        } = row;
        return { ...safe, has_submitted: hasSubmitted };
      }
      if (callerRole && row.role !== callerRole) {
        const {
          note,
          hasil_sidang,
          file_content,
          file_name,
          submitted_at,
          ...safe
        } = row;
        return { ...safe, has_submitted: hasSubmitted };
      }
      const { file_content, ...safe } = row;
      return { ...safe, has_submitted: hasSubmitted };
    });

    return res.json({
      ok: true,
      data: {
        sidang,
        penilaian: sanitizedPenilaian,
        notulen: sanitizedNotulen,
        hasilPenilaian: isStudent ? null : (hasilPenilaian ?? null),
        files,
      },
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /sidang/:pengajuanDisposisiPembimbingId/start
exports.startSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat memulai sidang" });
    }

    const sidang = await getSidangBySkripsiId(
      db,
      skripsiId,
      await resolveJenis(db, skripsiId),
    );
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    const callerRole = resolveSidangRole(sidang, nidn);
    if (callerRole !== "PEMBIMBING_1" && callerRole !== "PEMBIMBING_2") {
      return res.status(403).json({
        ok: false,
        message:
          "Hanya Pembimbing 1 atau Pembimbing 2 yang dapat memulai sidang",
      });
    }

    if (sidang.status === "ONGOING") {
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    await db.query(
      `UPDATE sidang SET status = 'ONGOING', updated_at = NOW() WHERE id = ?`,
      [sidang.id],
    );

    const studentSidangLink = `/student/sidang`;
    const lecturerSidangLink = `/pembimbing/sidang/${skripsiId}`;
    const [[studentUserRow]] = await db.query(
      `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
      [sidang.npm],
    );
    if (studentUserRow) {
      await insertNotification(
        db,
        studentUserRow.id,
        "SIDANG_STARTED",
        isSeminarSidang(sidang)
          ? "Seminar proposal Anda telah dimulai."
          : "Sidang skripsi Anda telah dimulai.",
        studentSidangLink,
      );
    }
    const lecturerMsg = `${isSeminarSidang(sidang) ? "Seminar proposal" : "Sidang skripsi"} ${sidang.nama_mahasiswa} telah dimulai.`;
    for (const lecNidn of [
      sidang.pembimbing1_nidn,
      sidang.pembimbing2_nidn,
      sidang.penguji1_nidn,
      sidang.penguji2_nidn,
    ]) {
      const lecId = await resolveUserId(db, lecNidn);
      if (lecId) {
        await insertNotification(
          db,
          lecId,
          "SIDANG_STARTED",
          lecturerMsg,
          lecturerSidangLink,
        );
      }
    }

    return res.json({ ok: true, message: "Sidang berhasil dimulai" });
  } catch (err) {
    next(err);
  }
};

// POST /sidang/:skripsiId/notulen
exports.submitNotulen = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat mengisi notulen" });
    }

    const { note } = req.body;
    if (!note) {
      return res.status(400).json({ ok: false, message: "note wajib diisi" });
    }
    const jenis = await resolveJenis(conn, skripsiId);

    await conn.beginTransaction();
    txStarted = true;

    await lockLatestSidang(conn, skripsiId, jenis);
    const sidang = await getSidangBySkripsiId(conn, skripsiId, jenis);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (!role || !["PENGUJI_1", "PENGUJI_2"].includes(role)) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Hanya penguji yang dapat mengisi notulen",
      });
    }

    await conn.query(
      `UPDATE sidang_notulen
       SET note = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ? AND role = ?`,
      [note, sidang.id, role],
    );

    const callerNama =
      role === "PENGUJI_1" ? sidang.penguji1_nama : sidang.penguji2_nama;
    const pembimbing1UserId = await resolveUserId(
      conn,
      sidang.pembimbing1_nidn,
    );
    if (pembimbing1UserId) {
      await insertNotification(
        conn,
        pembimbing1UserId,
        "SIDANG_NOTULEN_SUBMITTED",
        `${callerNama} telah mengumpulkan notulen ${sidangLabel(sidang)} ${sidang.nama_mahasiswa}.`,
        `/pembimbing/sidang/${skripsiId}`,
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Notulen berhasil disimpan" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /sidang/:skripsiId/penilaian
exports.submitPenilaian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(403).json({
        ok: false,
        message: "Hanya dosen yang dapat mengisi penilaian",
      });
    }

    const {
      nilaiIsi,
      keteranganIsi,
      nilaiBahasa,
      keteranganBahasa,
      nilaiTsp,
      keteranganTsp,
      nilaiPenguasaan,
      keteranganPenguasaan,
      nilaiPenunjang,
      keteranganPenunjang,
    } = req.body;

    const requiredNilai = [
      nilaiIsi,
      nilaiBahasa,
      nilaiTsp,
      nilaiPenguasaan,
      nilaiPenunjang,
    ];
    if (requiredNilai.some((v) => v === undefined || v === null)) {
      return res
        .status(400)
        .json({ ok: false, message: "Semua nilai wajib diisi" });
    }
    const parsedNilai = requiredNilai.map(Number);
    if (parsedNilai.some((v) => !Number.isFinite(v))) {
      return res
        .status(400)
        .json({ ok: false, message: "Nilai harus berupa angka" });
    }
    const outOfRangeIdx = parsedNilai.findIndex(
      (v, i) => v < 0 || v > NILAI_MAX[NILAI_KEYS[i]],
    );
    if (outOfRangeIdx !== -1) {
      const key = NILAI_KEYS[outOfRangeIdx];
      return res.status(400).json({
        ok: false,
        message: `Nilai ${key} harus antara 0 dan ${NILAI_MAX[key]} (bobot ${BOBOT[key] * 100}%)`,
      });
    }
    const jenis = await resolveJenis(conn, skripsiId);

    await conn.beginTransaction();
    txStarted = true;

    await lockLatestSidang(conn, skripsiId, jenis);
    const sidang = await getSidangBySkripsiId(conn, skripsiId, jenis);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (!role) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(403)
        .json({ ok: false, message: "Anda bukan peserta sidang ini" });
    }

    const [[sigRow]] = await conn.query(
      `SELECT dsnTtd AS signature_image
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [nidn],
    );

    assertSignatures([
      {
        role: ROLE_LABEL[role] ?? role,
        nama:
          role === "PEMBIMBING_1"
            ? sidang.pembimbing1_nama
            : role === "PEMBIMBING_2"
              ? sidang.pembimbing2_nama
              : role === "PENGUJI_1"
                ? sidang.penguji1_nama
                : sidang.penguji2_nama,
        signatureImage: sigRow?.signature_image,
      },
    ]);

    const [nIsi, nBahasa, nTsp, nPenguasaan, nPenunjang] = parsedNilai;
    // Each komponen is already entered in weighted points, so total is a plain sum.
    const totalNilai = nIsi + nBahasa + nTsp + nPenguasaan + nPenunjang;

    const tanggalFormatted = sidang.tanggal_sidang
      ? formatTanggal(new Date(sidang.tanggal_sidang))
      : "";

    const ujianKeNum = sidang.ujian_ke ?? 1;
    const UJIAN_KE_LABEL = [
      "",
      "Pertama",
      "Kedua",
      "Ketiga",
      "Keempat",
      "Kelima",
    ];
    const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

    const participantNama =
      role === "PEMBIMBING_1"
        ? sidang.pembimbing1_nama
        : role === "PEMBIMBING_2"
          ? sidang.pembimbing2_nama
          : role === "PENGUJI_1"
            ? sidang.penguji1_nama
            : sidang.penguji2_nama;

    const generateKomponenPenilaian = isSeminarSidang(sidang)
      ? generateKomponenPenilaianSeminarProposalFTI
      : generateKomponenPenilaianUjianSkripsiKomprehensifFTI;
    const outputBuffer =
      await generateKomponenPenilaian({
        mahasiswa: {
          nama: sidang.nama_mahasiswa,
          npm: sidang.npm,
          programStudi: sidang.program_studi_nama,
          judulSkripsi: sidang.judul_skripsi,
        },
        ujianKe: ujianKeStr,
        tanggalUjian: tanggalFormatted,
        tanggalDokumen: tanggalFormatted,
        penilai: {
          role:
            isSeminarSidang(sidang) && role === "PENGUJI_1"
              ? "Penguji"
              : ROLE_LABEL[role],
          nama: participantNama,
          signatureBase64: sigRow?.signature_image ?? null,
        },
        komponenPenilaian: [
          {
            komponen: "ISI",
            bobot: BOBOT.isi * 100,
            nilai: nIsi,
            keterangan: keteranganIsi ?? "",
          },
          {
            komponen: "BAHASA",
            bobot: BOBOT.bahasa * 100,
            nilai: nBahasa,
            keterangan: keteranganBahasa ?? "",
          },
          {
            komponen: "TEKNIK & SISTEMATIKA PENULISAN",
            bobot: BOBOT.tsp * 100,
            nilai: nTsp,
            keterangan: keteranganTsp ?? "",
          },
          {
            komponen: "PENGUASAAN MATERI",
            bobot: BOBOT.penguasaan * 100,
            nilai: nPenguasaan,
            keterangan: keteranganPenguasaan ?? "",
          },
          {
            komponen: "KOMPONEN PENUNJANG",
            bobot: BOBOT.penunjang * 100,
            nilai: nPenunjang,
            keterangan: keteranganPenunjang ?? "",
          },
        ],
      });
    const fileBase64 = Buffer.from(outputBuffer).toString("base64");
    const fileName = `Penilaian_${role}_${sidang.npm}.pdf`;

    await conn.query(
      `UPDATE sidang_penilaian
       SET nilai_isi = ?, keterangan_isi = ?,
           nilai_bahasa = ?, keterangan_bahasa = ?,
           nilai_tsp = ?, keterangan_tsp = ?,
           nilai_penguasaan = ?, keterangan_penguasaan = ?,
           nilai_penunjang = ?, keterangan_penunjang = ?,
           total_nilai = ?,
           file_content = ?, file_name = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ? AND role = ?`,
      [
        nIsi,
        keteranganIsi ?? null,
        nBahasa,
        keteranganBahasa ?? null,
        nTsp,
        keteranganTsp ?? null,
        nPenguasaan,
        keteranganPenguasaan ?? null,
        nPenunjang,
        keteranganPenunjang ?? null,
        totalNilai,
        fileBase64,
        fileName,
        sidang.id,
        role,
      ],
    );

    if (role !== "PEMBIMBING_1") {
      const callerNama =
        role === "PEMBIMBING_2"
          ? sidang.pembimbing2_nama
          : role === "PENGUJI_1"
            ? sidang.penguji1_nama
            : sidang.penguji2_nama;
      const pembimbing1UserId = await resolveUserId(
        conn,
        sidang.pembimbing1_nidn,
      );
      if (pembimbing1UserId) {
        await insertNotification(
          conn,
          pembimbing1UserId,
          "SIDANG_PENILAIAN_SUBMITTED",
          `${callerNama} telah mengumpulkan penilaian ${sidangLabel(sidang)} ${sidang.nama_mahasiswa}.`,
          `/pembimbing/sidang/${skripsiId}`,
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Penilaian berhasil disimpan" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /sidang/:skripsiId/hasil-penilaian
exports.submitHasilPenilaian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(403).json({
        ok: false,
        message: "Hanya dosen yang dapat mengisi hasil penilaian",
      });
    }

    const { hasilSidang, catatanPenguji, judulBaru } = req.body;
    if (!hasilSidang) {
      return res
        .status(400)
        .json({ ok: false, message: "hasilSidang wajib diisi" });
    }
    const jenis = await resolveJenis(conn, skripsiId);
    const allowedHasil = HASIL_SIDANG_BY_JENIS[jenis];
    if (!allowedHasil.includes(hasilSidang)) {
      return res.status(400).json({
        ok: false,
        message: `hasilSidang harus ${allowedHasil.join(", ")}`,
      });
    }

    // "Judul perlu diubah": an optional new title, only for a Seminar whose title is accepted.
    // Stored on the sidang and applied to skripsi.judul when the SK Skripsi is issued.
    let judulBaruValue = null;
    if (judulBaru !== undefined && judulBaru !== null && judulBaru !== "") {
      if (jenis !== JENIS.SEMINAR_BISNIS_DIGITAL) {
        return res.status(400).json({
          ok: false,
          message: "Perubahan judul hanya untuk Seminar Bisnis Digital",
        });
      }
      if (hasilSidang !== "JUDUL_DITERIMA") {
        return res.status(400).json({
          ok: false,
          message: "Judul baru hanya dapat diisi jika judul diterima",
        });
      }
      judulBaruValue = String(judulBaru).trim();
      if (!judulBaruValue) {
        return res
          .status(400)
          .json({ ok: false, message: "Judul baru tidak boleh kosong" });
      }
      if (judulBaruValue.length > 255) {
        return res
          .status(400)
          .json({ ok: false, message: "Judul baru maksimal 255 karakter" });
      }
    }

    await conn.beginTransaction();
    txStarted = true;

    await lockLatestSidang(conn, skripsiId, jenis);
    const sidang = await getSidangBySkripsiId(conn, skripsiId, jenis);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (role !== "PEMBIMBING_1" && role !== "PEMBIMBING_2") {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message:
          "Hanya Pembimbing 1 atau Pembimbing 2 yang dapat mengisi hasil penilaian akhir",
      });
    }

    // Gate: all 4 penilaian must be submitted
    const [penilaianRows] = await conn.query(
      `SELECT role, total_nilai, submitted_at FROM sidang_penilaian WHERE sidang_id = ?`,
      [sidang.id],
    );
    const unsubmitted = penilaianRows.filter((r) => !r.submitted_at);
    if (unsubmitted.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Penilaian belum lengkap. Belum disubmit: ${unsubmitted.map((r) => r.role).join(", ")}`,
      });
    }

    // Gate: both penguji must have submitted their notulen
    const [notulenGateRows] = await conn.query(
      `SELECT role FROM sidang_notulen WHERE sidang_id = ? AND submitted_at IS NOT NULL`,
      [sidang.id],
    );
    const submittedNotulenRoles = new Set(notulenGateRows.map((r) => r.role));
    const missingNotulen = notulenRolesFor(sidang).filter(
      (r) => !submittedNotulenRoles.has(r),
    );
    if (missingNotulen.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Notulen belum lengkap. Belum disubmit: ${missingNotulen.join(", ")}`,
      });
    }

    const byRole = {};
    for (const row of penilaianRows)
      byRole[row.role] = Number(row.total_nilai ?? 0);

    const nilaiP1 = byRole["PEMBIMBING_1"] ?? 0;
    const nilaiP2 = byRole["PEMBIMBING_2"] ?? 0;
    const nilaiPg1 = byRole["PENGUJI_1"] ?? 0;
    const nilaiPg2 = byRole["PENGUJI_2"] ?? 0;
    const totalNilai = nilaiP1 + nilaiP2 + nilaiPg1 + nilaiPg2;
    // One penilaian row per participant: 4 for Skripsi, 3 for a Seminar (no Penguji 2).
    const rata = totalNilai / penilaianRows.length;
    const grade = computeGrade(rata);

    // Verdict must match the computed rata — mirrors the frontend's disabled radios.
    if (isSeminarSidang(sidang)) {
      const expected = rata >= 60 ? "JUDUL_DITERIMA" : "JUDUL_DITOLAK";
      if (hasilSidang !== expected) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message:
            rata >= 60
              ? "Rata-rata >= 60 (grade A–C), judul harus diterima."
              : "Rata-rata < 60 (grade D), judul harus ditolak.",
        });
      }
    } else if (rata >= 60 && hasilSidang !== "LULUS") {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Rata-rata >= 60, hasil sidang harus LULUS.",
      });
    }
    if (rata < 60 && hasilSidang === "LULUS") {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Rata-rata < 60, hasil sidang tidak boleh LULUS.",
      });
    }

    // Hasil Penilaian Akhir DOCX is always signed by Pembimbing 1, regardless of
    // which pembimbing (P1 or P2) actually submits this form.
    const [[sigRow]] = await conn.query(
      `SELECT dsnTtd AS signature_image
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [sidang.pembimbing1_nidn],
    );

    assertSignatures([
      {
        role: "Pembimbing 1",
        nama: sidang.pembimbing1_nama,
        signatureImage: sigRow?.signature_image,
      },
    ]);

    const tanggalFormatted = sidang.tanggal_sidang
      ? formatTanggal(new Date(sidang.tanggal_sidang))
      : "";

    const ujianKeNum = sidang.ujian_ke ?? 1;
    const UJIAN_KE_LABEL = [
      "",
      "Pertama",
      "Kedua",
      "Ketiga",
      "Keempat",
      "Kelima",
    ];
    const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

    const hasilData = {
      mahasiswa: {
        nama: sidang.nama_mahasiswa,
        npm: sidang.npm,
        programStudi: sidang.program_studi_nama,
        judulSkripsi: sidang.judul_skripsi,
      },
      ujianKe: ujianKeStr,
      tanggal: tanggalFormatted,
    };
    const pembimbingPertama = {
      nama: sidang.pembimbing1_nama,
      nilai: nilaiP1,
      signatureBase64: sigRow?.signature_image ?? null,
    };
    const pembimbingKedua = { nama: sidang.pembimbing2_nama, nilai: nilaiP2 };
    const hasilBuffer = isSeminarSidang(sidang)
      ? await generateHasilPenilaianAkhirSeminarProposalFTI({
          ...hasilData,
          timPenguji: {
            pembimbingPertama,
            pembimbingKedua,
            penguji: { nama: sidang.penguji1_nama, nilai: nilaiPg1 },
          },
        })
      : await generateHasilPenilaianAkhirUjianSkripsiFTI({
          ...hasilData,
          timPenguji: {
            pembimbingPertama,
            pembimbingKedua,
            pengujiUtama: { nama: sidang.penguji1_nama, nilai: nilaiPg1 },
            anggotaPenguji: { nama: sidang.penguji2_nama, nilai: nilaiPg2 },
          },
        });
    const hasilBase64 = Buffer.from(hasilBuffer).toString("base64");

    // Upsert sidang_hasil_penilaian
    await conn.query(
      `UPDATE sidang_hasil_penilaian
       SET nilai_pembimbing1 = ?, nilai_pembimbing2 = ?, nilai_penguji1 = ?, nilai_penguji2 = ?,
           total_nilai = ?, rata = ?, grade = ?, hasil_sidang = ?, catatan_penguji = ?,
           file_content = ?, file_name = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ?`,
      [
        nilaiP1,
        nilaiP2,
        nilaiPg1,
        nilaiPg2,
        totalNilai,
        rata,
        grade,
        hasilSidang,
        catatanPenguji ?? null,
        hasilBase64,
        `Hasil_Penilaian_Akhir_${sidang.npm}.pdf`,
        sidang.id,
      ],
    );

    // sync'd copy of sidang_hasil_penilaian.hasil_sidang — written together in one transaction
    await conn.query(
      `UPDATE sidang SET hasil_sidang = ?, catatan_penguji = ?, judul_baru = ?, updated_at = NOW() WHERE id = ?`,
      [hasilSidang, catatanPenguji ?? null, judulBaruValue, sidang.id],
    );

    // Generate notulen DOCXs now that hasil_sidang is authoritative
    await generateAndStoreNotulen(conn, sidang, hasilSidang);

    // Generate Berita Acara
    await generateAndStoreBeritaAcara(conn, sidang, {
      hasilSidang,
      catatanPenguji: catatanPenguji ?? "",
      nilaiUjian: rata,
      penilaianRows,
    });

    // Mark sidang as COMPLETED
    await conn.query(
      `UPDATE sidang SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [sidang.id],
    );

    // GAGAL (plagiarism) or a rejected Seminar title: invalidate the skripsi, no revision phase —
    // the student restarts from Pengajuan Outline.
    if (hasilSidang === "GAGAL" || hasilSidang === "JUDUL_DITOLAK") {
      await conn.query(
        `UPDATE skripsi SET status = 'GAGAL', updated_at = NOW() WHERE id = (SELECT skripsi_id FROM sidang WHERE id = ?)`,
        [sidang.id],
      );
      const [[studentUserRow]] = await conn.query(
        `SELECT u.id FROM users u WHERE u.npm = ? AND u.is_active = 1 LIMIT 1`,
        [sidang.npm],
      );
      if (studentUserRow) {
        await insertNotification(
          conn,
          studentUserRow.id,
          hasilSidang === "GAGAL" ? "SIDANG_GAGAL" : "SIDANG_JUDUL_DITOLAK",
          hasilSidang === "GAGAL"
            ? "Skripsi Anda dinyatakan GAGAL karena terindikasi plagiat. Anda dapat mengulang dari awal pada semester berikutnya."
            : `Judul Anda tidak diterima dalam seminar proposal (nilai ${rata.toFixed(2)}, grade ${grade}). Silakan mengulang dari pengajuan outline.`,
          `/student/sidang`,
        );
      }
      if (hasilSidang === "JUDUL_DITOLAK") {
        const lecturerMsg = `Seminar proposal ${sidang.nama_mahasiswa} telah selesai: judul tidak diterima (nilai: ${rata.toFixed(2)}, grade: ${grade}).`;
        for (const lecNidn of [
          sidang.pembimbing1_nidn,
          sidang.pembimbing2_nidn,
          sidang.penguji1_nidn,
        ]) {
          const lecId = await resolveUserId(conn, lecNidn);
          if (lecId) {
            await insertNotification(
              conn,
              lecId,
              "SIDANG_JUDUL_DITOLAK",
              lecturerMsg,
              `/pembimbing/sidang/${skripsiId}`,
            );
          }
        }
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Hasil penilaian akhir berhasil disimpan. Sidang selesai.",
      });
    }

    // One revisi per sidang: an ujian ulang gets its own revisi, and the earlier
    // attempt's revisi stays as history.
    const [[existingRevisi]] = await conn.query(
      `SELECT id FROM revisi_pasca_sidang WHERE sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!existingRevisi) {
      await conn.query(
        `INSERT INTO revisi_pasca_sidang (sidang_id) VALUES (?)`,
        [sidang.id],
      );
    }

    // Notify student + all participants of the LULUS / TIDAK_LULUS / JUDUL_DITERIMA result
    const notifType =
      hasilSidang === "JUDUL_DITERIMA"
        ? "SIDANG_JUDUL_DITERIMA"
        : hasilSidang === "LULUS"
          ? "SIDANG_LULUS"
          : "SIDANG_TIDAK_LULUS";
    const studentSidangLink = `/student/sidang`;
    const lecturerSidangLink = `/pembimbing/sidang/${skripsiId}`;
    const judulBaruNote = judulBaruValue
      ? ` Judul perlu diubah menjadi: "${judulBaruValue}".`
      : "";
    const [[studentRow]] = await conn.query(
      `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
      [sidang.npm],
    );
    if (studentRow) {
      const studentMsg =
        hasilSidang === "JUDUL_DITERIMA"
          ? `Selamat! Judul Anda diterima dalam seminar proposal dengan nilai ${rata.toFixed(2)} (${grade}). Silakan lanjut ke revisi.${judulBaruNote}`
          : hasilSidang === "LULUS"
            ? `Selamat! Anda dinyatakan LULUS dalam sidang skripsi dengan nilai ${rata.toFixed(2)} (${grade}).`
            : "Anda dinyatakan TIDAK LULUS dalam sidang skripsi. Anda dapat mengikuti ujian ulang.";
      await insertNotification(
        conn,
        studentRow.id,
        notifType,
        studentMsg,
        studentSidangLink,
      );
    }
    const lecturerMsg =
      hasilSidang === "JUDUL_DITERIMA"
        ? `Seminar proposal ${sidang.nama_mahasiswa} telah selesai: judul diterima (nilai: ${rata.toFixed(2)}, grade: ${grade}).${judulBaruNote}`
        : hasilSidang === "LULUS"
          ? `Sidang skripsi ${sidang.nama_mahasiswa} telah selesai dengan hasil LULUS (nilai: ${rata.toFixed(2)}, grade: ${grade}).`
          : `Sidang skripsi ${sidang.nama_mahasiswa} telah selesai dengan hasil TIDAK LULUS.`;
    for (const lecNidn of [
      sidang.pembimbing1_nidn,
      sidang.pembimbing2_nidn,
      sidang.penguji1_nidn,
      sidang.penguji2_nidn,
    ]) {
      const lecId = await resolveUserId(conn, lecNidn);
      if (lecId) {
        await insertNotification(
          conn,
          lecId,
          notifType,
          lecturerMsg,
          lecturerSidangLink,
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Hasil penilaian akhir berhasil disimpan. Sidang selesai.",
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// Fatal like Berita Acara: both notulen are required documents, so a generation failure rolls
// back hasil-penilaian instead of completing the sidang with a notulen that has no file.
async function generateAndStoreNotulen(conn, sidang, hasilSidang) {
  const [notulenRows] = await conn.query(
    `SELECT role, note FROM sidang_notulen WHERE sidang_id = ? AND submitted_at IS NOT NULL`,
    [sidang.id],
  );

  const tanggalFormatted = sidang.tanggal_sidang
    ? formatTanggal(new Date(sidang.tanggal_sidang))
    : "";

  for (const row of notulenRows) {
    const role = row.role;
    const mahasiswa = {
      npm: sidang.npm,
      nama: sidang.nama_mahasiswa,
      programStudi: sidang.program_studi_nama,
      judulSkripsi: sidang.judul_skripsi,
    };
    const pembimbing = {
      pertama: sidang.pembimbing1_nama,
      kedua: sidang.pembimbing2_nama,
    };
    const namaPenguji =
      role === "PENGUJI_1" ? sidang.penguji1_nama : sidang.penguji2_nama;

    // Signed only when the penguji approves the student's revision (revisiPascaSidang.reviewRevisi)
    const outputBuffer = isSeminarSidang(sidang)
      ? await generateNotulenSeminarProposalFTI({
          mahasiswa,
          pembimbing,
          tanggalSeminar: tanggalFormatted,
          hasilSeminar: HASIL_SEMINAR_LABEL[hasilSidang],
          penguji: { nama: namaPenguji, signatureBase64: null },
          note: row.note,
        })
      : await generateNotulenPengujiFTI({
          mahasiswa,
          pembimbing,
          tanggalSidang: tanggalFormatted,
          hasilSidang: hasilSidang === "LULUS" ? "Lulus" : "Tidak Lulus",
          penguji: {
            role: NOTULEN_ROLE_LABEL[role],
            nama: namaPenguji,
            signatureBase64: null,
          },
          note: row.note,
        });
    const fileBase64 = Buffer.from(outputBuffer).toString("base64");
    await conn.query(
      `UPDATE sidang_notulen
       SET hasil_sidang = ?, file_content = ?, file_name = ?, updated_at = NOW()
       WHERE sidang_id = ? AND role = ?`,
      [
        hasilSidang,
        fileBase64,
        `Notulen_${role}_${sidang.npm}.pdf`,
        sidang.id,
        role,
      ],
    );
  }
}

async function generateAndStoreBeritaAcara(
  conn,
  sidang,
  { hasilSidang, catatanPenguji, nilaiUjian },
) {
  const tanggalSidangDate = sidang.tanggal_sidang
    ? new Date(sidang.tanggal_sidang)
    : new Date();
  const hariStr = formatHari(tanggalSidangDate);
  const tanggalStr = formatTanggal(tanggalSidangDate);
  const waktuStr = sidang.waktu_sidang
    ? String(sidang.waktu_sidang).substring(0, 5)
    : "";

  const ujianKeNum = sidang.ujian_ke ?? 1;
  const UJIAN_KE_LABEL = [
    "",
    "Pertama",
    "Kedua",
    "Ketiga",
    "Keempat",
    "Kelima",
  ];
  const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

  // Get signatures for all four lecturer participants from SIMIKO.
  async function getSig(nidn) {
    if (!nidn) return null;
    const [[row]] = await conn.query(
      `SELECT dsnTtd AS signature_image
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [nidn],
    );
    return row?.signature_image ?? null;
  }

  const isSeminar = isSeminarSidang(sidang);
  const [sig1, sig2, sigPg1, sigPg2] = await Promise.all([
    getSig(sidang.pembimbing1_nidn),
    getSig(sidang.pembimbing2_nidn),
    getSig(sidang.penguji1_nidn),
    isSeminar ? null : getSig(sidang.penguji2_nidn),
  ]);

  assertSignatures([
    {
      role: "Pembimbing 1",
      nama: sidang.pembimbing1_nama,
      signatureImage: sig1,
    },
    {
      role: "Pembimbing 2",
      nama: sidang.pembimbing2_nama,
      signatureImage: sig2,
    },
    isSeminar
      ? { role: "Penguji", nama: sidang.penguji1_nama, signatureImage: sigPg1 }
      : { role: "Penguji 1", nama: sidang.penguji1_nama, signatureImage: sigPg1 },
    ...(isSeminar
      ? []
      : [
          {
            role: "Penguji 2",
            nama: sidang.penguji2_nama,
            signatureImage: sigPg2,
          },
        ]),
  ]);

  const beritaAcaraData = {
    hari: hariStr,
    tanggalUjian: tanggalStr,
    waktu: waktuStr,
    mahasiswa: {
      nama: sidang.nama_mahasiswa,
      npm: sidang.npm,
      programStudi: sidang.program_studi_nama,
      judulSkripsi: sidang.judul_skripsi,
    },
    ujianKe: ujianKeStr,
    nilaiUjian,
    tanggalDokumen: tanggalStr,
    catatanMajelisPenguji: catatanPenguji ?? "",
  };
  const ketua = { nama: sidang.pembimbing1_nama, signatureBase64: sig1 };
  const sekretaris = { nama: sidang.pembimbing2_nama, signatureBase64: sig2 };
  const outputBuffer = isSeminar
    ? await generateBeritaAcaraHasilSeminarProposalFTI({
        ...beritaAcaraData,
        hasilSeminar: HASIL_SEMINAR_LABEL[hasilSidang],
        majelisPenguji: {
          ketua,
          sekretaris,
          penguji: { nama: sidang.penguji1_nama, signatureBase64: sigPg1 },
        },
      })
    : await generateBeritaAcaraHasilUjianSkripsiKomprehensifFTI({
        ...beritaAcaraData,
        hasilUjian: hasilSidang === "LULUS" ? "Lulus" : "Tidak Lulus",
        majelisPenguji: {
          ketua,
          sekretaris,
          pengujiUtama: { nama: sidang.penguji1_nama, signatureBase64: sigPg1 },
          anggotaPenguji: { nama: sidang.penguji2_nama, signatureBase64: sigPg2 },
        },
      });
  const fileBase64 = Buffer.from(outputBuffer).toString("base64");
  const fileName = `Berita_Acara_${sidang.npm}.pdf`;

  await conn.query(`DELETE FROM sidang_files WHERE sidang_id = ?`, [sidang.id]);
  await conn.query(
    `INSERT INTO sidang_files (sidang_id, file_name, file_content) VALUES (?, ?, ?)`,
    [sidang.id, fileName, fileBase64],
  );
}

const VALID_SIDANG_STATUSES = ["SCHEDULED", "ONGOING", "COMPLETED"];

// GET /lecturer/sidang
exports.getLecturerSidang = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn)
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });

    const { status } = req.query;
    if (status !== undefined && !VALID_SIDANG_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_SIDANG_STATUSES.join(", ")}`,
      });
    }

    const whereStatus = status ? `AND s.status = ?` : "";
    const params = [nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn];
    if (status) params.push(status);

    const [rows] = await db.query(
      `SELECT
        s.id,
        s.skripsi_id,
        s.jenis,
        m.npm,
        m.nama AS nama_mahasiswa,
        sk.judul AS judul_skripsi,
        s.status,
        psk_k.tanggal_sidang,
        psk_k.waktu_sidang,
        psk_k.tempat_sidang,
        s.hasil_sidang,
        shp.rata,
        shp.grade,
        CASE
          WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
          WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
        END AS caller_role,
        (sp.submitted_at IS NOT NULL) AS has_submitted_penilaian,
        (sn.submitted_at IS NOT NULL) AS has_submitted_notulen
      FROM sidang s
      JOIN skripsi sk ON sk.id = s.skripsi_id
      JOIN mahasiswa m ON m.npm = sk.npm
      LEFT JOIN pengajuan_sidang_kaprodi psk_k
             ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
      LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id
      LEFT JOIN sidang_penilaian sp
        ON sp.sidang_id = s.id
        AND sp.role = CASE
          WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
          WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
        END
      LEFT JOIN sidang_notulen sn
        ON sn.sidang_id = s.id
        AND sn.role = CASE
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
          ELSE NULL
        END
      WHERE (
        sk.pembimbing1_nidn = ? OR sk.pembimbing2_nidn = ? OR
        psk_k.penguji1_nidn = ? OR psk_k.penguji2_nidn = ?
      )
      ${whereStatus}
      ORDER BY s.created_at DESC`,
      [...params, nidn, nidn, nidn, nidn],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getKaprodiSidang = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const { status, tahunAkademik, periodeAkademik } = req.query;
    const q = String(req.query.q ?? "").trim();
    const pagination = parsePagination(req.query);
    if (status !== undefined && !VALID_SIDANG_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_SIDANG_STATUSES.join(", ")}`,
      });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    const programStudiIds = staffUsrId
      ? await getKaprodiProgramStudiIds(staffUsrId)
      : [];
    if (programStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const placeholders = programStudiIds.map(() => "?").join(",");
    const periodConditions = [];
    const periodParams = [];
    if (tahunAkademik) {
      periodConditions.push("ssp.tahun_akademik = ?");
      periodParams.push(String(tahunAkademik));
    }
    if (periodeAkademik) {
      periodConditions.push("ssp.periode_akademik = ?");
      periodParams.push(String(periodeAkademik));
    }
    const searchCondition = q
      ? "AND (m.nama LIKE ? OR m.npm LIKE ? OR sk.judul LIKE ?)"
      : "";
    const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
       LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
       WHERE prog.id IN (${placeholders})
         AND (? IS NULL OR s.status = ?)
         ${searchCondition}
         ${periodConditions.map((c) => `AND ${c}`).join(" ")}`,
      [...programStudiIds, status ?? null, status ?? null, ...searchParams, ...periodParams],
    );

    const [rows] = await db.query(
      `SELECT
         s.id, s.skripsi_id, s.jenis, s.nomor_surat,
         m.npm, m.nama AS nama_mahasiswa,
         prog.id   AS program_studi_id,
         prog.nama AS program_studi_nama,
         sk.judul  AS judul_skripsi,
         ps.ujian_ke,
         s.status, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
         sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama,
         s.hasil_sidang, s.created_at,
         shp.rata, shp.grade
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
       LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id
       LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
       WHERE prog.id IN (${placeholders})
         AND (? IS NULL OR s.status = ?)
         ${searchCondition}
         ${periodConditions.map((c) => `AND ${c}`).join(" ")}
       ORDER BY s.created_at DESC${pagination.enabled ? " LIMIT ? OFFSET ?" : ""}`,
      pagination.enabled
        ? [...programStudiIds, status ?? null, status ??null, ...searchParams, ...periodParams, pagination.limit, pagination.offset]
        : [...programStudiIds, status ?? null, status ?? null, ...searchParams, ...periodParams],
    );

    pagination.totalItems = Number(countRow.total);
    return listResponse(res, { rows, pagination });
  } catch (err) {
    next(err);
  }
};

async function resolveSidangFileAccess(req, sidang) {
  if (req.user.hasRole("SEKRETARIAT")) return true;
  if (req.user.hasRole("KAPRODI")) {
    return isKaprodiOfProgramStudi(req.user.id, sidang.program_studi_id);
  }
  if (req.user.hasRole("STUDENT")) {
    const npm = await getStudentNpm(req.user.id);
    return npm === sidang.npm;
  }
  const nidn = await getLecturerNidn(req.user.id);
  return nidn ? resolveSidangRole(sidang, nidn) !== null : false;
}

function sendPdf(res, fileRow, downloadFileName) {
  const buffer = Buffer.from(fileRow.file_content, "base64");
  res.setHeader("Content-Type", MIME_PDF);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${downloadFileName ?? fileRow.file_name}"`,
  );
  return res.send(buffer);
}

function buildSidangDownloadFileName(npm, namaMahasiswa, namaDokumen) {
  return `${npm} - ${namaMahasiswa} - ${namaDokumen}.pdf`;
}

// GET /sidang/:skripsiId/files/berita-acara
exports.getBeritaAcara = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const sidang = await getSidangForFileAccess(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!(await resolveSidangFileAccess(req, sidang))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_files WHERE sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({ ok: false, message: "Berita acara belum tersedia" });
    }

    return sendPdf(
      res,
      fileRow,
      buildSidangDownloadFileName(
        sidang.npm,
        sidang.nama_mahasiswa,
        "Berita Acara Hasil Ujian",
      ),
    );
  } catch (err) {
    next(err);
  }
};

// GET /sidang/:skripsiId/files/hasil-penilaian
exports.getHasilPenilaianFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const sidang = await getSidangForFileAccess(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!(await resolveSidangFileAccess(req, sidang))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_hasil_penilaian WHERE sidang_id = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({ ok: false, message: "Hasil penilaian belum tersedia" });
    }

    return sendPdf(
      res,
      fileRow,
      buildSidangDownloadFileName(
        sidang.npm,
        sidang.nama_mahasiswa,
        "Hasil Penilaian Akhir",
      ),
    );
  } catch (err) {
    next(err);
  }
};

const VALID_PENILAIAN_ROLES = [
  "PEMBIMBING_1",
  "PEMBIMBING_2",
  "PENGUJI_1",
  "PENGUJI_2",
];
const VALID_NOTULEN_ROLES = ["PENGUJI_1", "PENGUJI_2"];
const SIDANG_ROLE_LABELS = {
  PEMBIMBING_1: "Pembimbing 1",
  PEMBIMBING_2: "Pembimbing 2",
  PENGUJI_1: "Penguji 1",
  PENGUJI_2: "Penguji 2",
};

// GET /sidang/:skripsiId/files/penilaian/:role
exports.getPenilaianFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const role = req.params.role;
    if (!VALID_PENILAIAN_ROLES.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: `role harus salah satu dari: ${VALID_PENILAIAN_ROLES.join(", ")}`,
      });
    }

    const sidang = await getSidangForFileAccess(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!(await resolveSidangFileAccess(req, sidang))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_penilaian WHERE sidang_id = ? AND role = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id, role],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({ ok: false, message: "Formulir penilaian belum tersedia" });
    }

    return sendPdf(
      res,
      fileRow,
      buildSidangDownloadFileName(
        sidang.npm,
        sidang.nama_mahasiswa,
        `Formulir Penilaian ${SIDANG_ROLE_LABELS[role]}`,
      ),
    );
  } catch (err) {
    next(err);
  }
};

// GET /sidang/:skripsiId/files/notulen/:role
exports.getNotulenFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const role = req.params.role;
    if (!VALID_NOTULEN_ROLES.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: `role harus salah satu dari: ${VALID_NOTULEN_ROLES.join(", ")}`,
      });
    }

    const sidang = await getSidangForFileAccess(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (!(await resolveSidangFileAccess(req, sidang))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_notulen WHERE sidang_id = ? AND role = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id, role],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({ ok: false, message: "Notulen belum tersedia" });
    }

    return sendPdf(
      res,
      fileRow,
      buildSidangDownloadFileName(
        sidang.npm,
        sidang.nama_mahasiswa,
        `Notulen ${SIDANG_ROLE_LABELS[role]}`,
      ),
    );
  } catch (err) {
    next(err);
  }
};

// GET /sekretariat/sidang
exports.getSekretariatSidang = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const { status, programStudiId } = req.query;
    if (status !== undefined && !VALID_SIDANG_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_SIDANG_STATUSES.join(", ")}`,
      });
    }

    const parsedProgramStudiId = programStudiId ? Number(programStudiId) : null;
    if (
      programStudiId !== undefined &&
      (!Number.isFinite(parsedProgramStudiId) || parsedProgramStudiId <= 0)
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid programStudiId" });
    }

    const [rows] = await db.query(
      `SELECT
         s.id, s.skripsi_id, s.jenis, s.nomor_surat,
         m.npm, m.nama AS nama_mahasiswa,
         prog.id   AS program_studi_id,
         prog.nama AS program_studi_nama,
         sk.judul  AS judul_skripsi,
         ps.ujian_ke,
         s.status, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
         sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama,
         s.hasil_sidang, s.created_at,
         shp.rata, shp.grade
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
       LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id
       WHERE (? IS NULL OR s.status = ?)
         AND (? IS NULL OR prog.id = ?)
       ORDER BY s.created_at DESC`,
      [
        status ?? null,
        status ?? null,
        parsedProgramStudiId,
        parsedProgramStudiId,
      ],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
