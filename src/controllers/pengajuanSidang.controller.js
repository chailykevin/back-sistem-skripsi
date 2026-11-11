const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const { sendSuratUndangan } = require("../utils/email");
const {
  getOpenPeriod: getSidangOpenPeriod,
} = require("../services/sidangSubmissionPeriod.service");
const {
  attachSidangSystemFiles,
} = require("../services/pengajuanSidangSystemFiles.service");
const {
  JENIS,
  BISNIS_DIGITAL_PROGRAM_STUDI_KODE,
  resolveJenis,
  resolveReadJenis,
  getLatestSidang,
  countSidang,
  getActivePengajuanSidang,
  getEditablePengajuanSidang,
} = require("../services/sidangScope.service");
const dosenUjiSidangSkripsiProdiService = require("../services/dosenUjiSidangSkripsiProdi.service");
const path = require("path");
const {
  generatePermohonanUjianSkripsiFTI,
} = require("../services/generatePermohonanUjianSkripsiFTI.js");
const {
  generatePernyataanPerbaikanSkripsiFTI,
} = require("../services/generatePernyataanPerbaikanSkripsiFTI.js");
const {
  generatePernyataanKelengkapanDanNilaiMatkulFTI,
} = require("../services/generatePernyataanKelengkapanDanNilaiMatkulFTI.js");
const {
  generateUsulanPengujiFTI,
} = require("../services/generateUsulanPengujiFTI.js");
const {
  generatePernyataanPenyelesaianSkripsiFTI,
} = require("../services/generatePernyataanPenyelesaianSkripsiFTI.js");
const {
  formatWaktuSidang,
  generateSuratUndanganSidangFTI,
} = require("../services/generateSuratUndanganSidangFTI.js");
const {
  generatePermohonanSeminarProposalFTI,
} = require("../services/generatePermohonanSeminarProposalFTI.js");
const {
  generateSuratUndanganSeminarProposalFTI,
} = require("../services/generateSuratUndanganSeminarProposalFTI.js");
const {
  getStudentNpm,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const { assertSignatures, getStaffSignature } = require("../utils/signature");
const { BULAN_ROMAWI, formatTanggal } = require("../utils/dates");

function validateIpk(ipk) {
  if (ipk === null || ipk === undefined || ipk === "") return null;
  const num = Number(ipk);
  if (!Number.isFinite(num) || num < 0 || num > 4) {
    return "IPK harus berupa angka antara 0 dan 4";
  }
  return null;
}

function validateTglLahir(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { error: null, value: null };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { error: "Tanggal lahir tidak valid", value: null };
  }
  if (date.getTime() > Date.now()) {
    return { error: "Tanggal lahir tidak boleh di masa depan", value: null };
  }
  return { error: null, value: trimmed };
}

function validatePengujiAssignment({
  penguji1Nidn,
  penguji2Nidn,
  pembimbing1Nidn,
  pembimbing2Nidn,
}) {
  const p1 = penguji1Nidn ? String(penguji1Nidn).trim() : "";
  const p2 = penguji2Nidn ? String(penguji2Nidn).trim() : "";
  if (p1 && p2 && p1 === p2) {
    return "Penguji 1 dan Penguji 2 tidak boleh sama";
  }
  const pembimbingNidns = new Set(
    [pembimbing1Nidn, pembimbing2Nidn].filter(Boolean),
  );
  if ((p1 && pembimbingNidns.has(p1)) || (p2 && pembimbingNidns.has(p2))) {
    return "Penguji tidak boleh sama dengan pembimbing";
  }
  return null;
}

// Who sets the penguji and how many positions there are. Bisnis Digital students don't propose
// penguji (no Lembar Usulan Penguji): Kaprodi assigns them at disposisi. A Seminar has one penguji.
async function getPengujiRule(queryable, skripsiId, jenis) {
  const [[row]] = await queryable.query(
    `SELECT ps.kode
     FROM skripsi s
     JOIN program_studi ps ON ps.id = s.program_studi_id
     WHERE s.id = ? LIMIT 1`,
    [skripsiId],
  );
  return {
    studentPicks: row?.kode !== BISNIS_DIGITAL_PROGRAM_STUDI_KODE,
    hasPenguji2: jenis !== JENIS.SEMINAR_BISNIS_DIGITAL,
  };
}

// The student's skripsi if it may start this pengajuan: a Seminar once Pembimbing 1 has accepted
// Bab 3 (the skripsi stays IN_PROGRESS), a Skripsi once konsultasi is complete. Otherwise null.
async function getSkripsiReadyForSidang(conn, skripsiId, npm, jenis) {
  if (jenis === JENIS.SEMINAR_BISNIS_DIGITAL) {
    const [[row]] = await conn.query(
      `SELECT sk.id, sk.perlu_surat_pengantar
       FROM skripsi sk
       JOIN kartu_konsultasi_skripsi k ON k.skripsi_id = sk.id
       JOIN konsultasi_skripsi_stage st
         ON st.kartu_konsultasi_skripsi_id = k.id
        AND st.chapter_group = 'BAB_3'
        AND st.stage = 'PEMBIMBING_1'
        AND st.current_status = 'ACCEPTED'
       WHERE sk.id = ? AND sk.npm = ? AND sk.status = 'IN_PROGRESS'
       LIMIT 1`,
      [skripsiId, npm],
    );
    return row ?? null;
  }
  const [[row]] = await conn.query(
    `SELECT id, perlu_surat_pengantar FROM skripsi WHERE id = ? AND npm = ? AND status = 'COMPLETED' LIMIT 1`,
    [skripsiId, npm],
  );
  return row ?? null;
}

// A student who went through the Seminar may start Pengajuan Sidang Skripsi only once the SIMIKO sync
// shows they registered Skripsi (BDPB802) and their SK Skripsi has been issued through the bridge
// (Bab 4–5 may run before either). Returns the refusal message, or null when allowed.
async function getSkripsiRegistrationBlock(queryable, skripsiId, jenis) {
  if (jenis !== JENIS.SKRIPSI) return null;
  const [[row]] = await queryable.query(
    `SELECT s.jalur, m.tahap_tugas_akhir, l.status AS lanjutan_status
     FROM skripsi s
     JOIN mahasiswa m ON m.npm = s.npm
     LEFT JOIN pengajuan_sk_skripsi_lanjutan l ON l.skripsi_id = s.id
     WHERE s.id = ? LIMIT 1`,
    [skripsiId],
  );
  if (row?.jalur !== JENIS.SEMINAR_BISNIS_DIGITAL) return null;
  const notRegistered = row.tahap_tugas_akhir !== JENIS.SKRIPSI;
  const skPending = row.lanjutan_status !== "COMPLETED";
  if (notRegistered && skPending) {
    return "Pengajuan Sidang Skripsi dibuka setelah Anda terdaftar mata kuliah Skripsi di KRS dan SK Penulisan Skripsi Anda diterbitkan.";
  }
  if (notRegistered) {
    return "Pengajuan Sidang Skripsi dibuka setelah Anda terdaftar mata kuliah Skripsi di KRS.";
  }
  if (skPending) {
    return "Pengajuan Sidang Skripsi dibuka setelah SK Penulisan Skripsi Anda diterbitkan oleh Sekretariat.";
  }
  return null;
}

const PENGUJI_BY_KAPRODI_MESSAGE =
  "Penguji ditentukan oleh Kaprodi saat disposisi";
const SINGLE_PENGUJI_MESSAGE =
  "Seminar Bisnis Digital hanya memiliki satu penguji";

// Pass undefined/null for a position to skip checking it.
async function getIneligiblePengujiMessage(
  conn,
  programStudiId,
  jenis,
  { penguji1Nidn, penguji2Nidn },
) {
  const ineligible = await dosenUjiSidangSkripsiProdiService.findIneligible(
    conn,
    programStudiId,
    jenis,
    [
      { nidn: penguji1Nidn, role: "PENGUJI_1" },
      { nidn: penguji2Nidn, role: "PENGUJI_2" },
    ],
  );
  if (!ineligible.length) return null;
  const roleLabel = { PENGUJI_1: "Penguji 1", PENGUJI_2: "Penguji 2" };
  const names = ineligible
    .map(
      (d) =>
        `${roleLabel[d.role]}: ${d.nama ? `${d.nama} (${d.nidn})` : d.nidn}`,
    )
    .join(", ");
  return `Dosen penguji berikut tidak tersedia untuk posisi tersebut di program studi ini: ${names}`;
}

// The Lembar Usulan Penguji lists the prodi's eligible examiners and highlights the picks by NIDN.
// Callers check eligibility first (getIneligiblePengujiMessage), so both picks are on the lists.
async function buildPilihanPenguji(
  conn,
  programStudiId,
  jenis,
  { penguji1Nidn, penguji2Nidn },
) {
  const roster = await dosenUjiSidangSkripsiProdiService.listUsulanRoster(
    conn,
    programStudiId,
    jenis,
  );
  const nomor = (list, nidn) => list.findIndex((d) => d.nidn === nidn) + 1;
  return {
    utama: roster.utama.map((d) => d.nama),
    kedua: roster.kedua.map((d) => d.nama),
    utamaNomor: nomor(roster.utama, penguji1Nidn),
    keduaNomor: nomor(roster.kedua, penguji2Nidn),
  };
}


const ANGKA_TERBILANG = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
];

function terbilang(n) {
  const i = Number(n);
  return ANGKA_TERBILANG[i] ?? String(i);
}

const VALID_KAPRODI_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEED_REVISION",
  "VALID",
  "REJECTED",
  "DISPOSISI_SENT",
  "COMPLETED",
];

const ALL_FILE_TYPES = [
  "BERKAS_SKRIPSI",
  "SURAT_SURVEI",
  "SURAT_KETERANGAN",
  "JURNAL",
  "SURAT_PERNYATAAN_TIDAK_PLAGIAT",
  "LEMBAR_USULAN_PENGUJI",
  "LEMBAR_PERMOHONAN_UJIAN",
  "PAS_FOTO",
  "KTM",
  "BUKTI_PEMBAYARAN",
  "LEMBAR_KONSULTASI_JURNAL",
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
  "REKAP_NILAI",
  "SURAT_PERNYATAAN_PENYELESAIAN",
  "SURAT_PERNYATAAN_PERBAIKAN",
  "SURAT_PERNYATAAN_KELENGKAPAN",
  "FOTOCOPY_KONVERSI",
  "BUKTI_HADIR_SIDANG",
  "KARTU_KONSULTASI_PA",
  "KARTU_PRAKTIKUM",
  "SERTIFIKAT_POINT",
  "SURAT_UNDANGAN_SIDANG",
];

// Auto-pulled by system; mahasiswa cannot manually upload these
const SYSTEM_FILE_TYPES = [
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
  "LEMBAR_PERMOHONAN_UJIAN",
  "SURAT_PERNYATAAN_PERBAIKAN",
  "SURAT_PERNYATAAN_KELENGKAPAN",
  "LEMBAR_USULAN_PENGUJI",
  "SURAT_PERNYATAAN_PENYELESAIAN",
  "SURAT_UNDANGAN_SIDANG",
];

const OPTIONAL_FILE_TYPES = [
  "SURAT_SURVEI",
  "SURAT_KETERANGAN",
  "FOTOCOPY_KONVERSI",
];

// Required only when pengajuan_disposisi_pembimbing.perlu_surat_pengantar = 1

const REQUIRED_FILE_TYPES = ALL_FILE_TYPES.filter(
  (t) => !OPTIONAL_FILE_TYPES.includes(t),
);

// File types that Kaprodi verifies (skripsi content + optional skripsi content + consultation docs)
const KAPRODI_FILE_TYPES = [
  "BERKAS_SKRIPSI",
  "SURAT_PERNYATAAN_TIDAK_PLAGIAT",
  "SURAT_SURVEI",
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
];

// Optional skripsi content — uploadable at Kaprodi step but do NOT block the VALID gate
const KAPRODI_OPTIONAL_FILE_TYPES = ["SURAT_SURVEI"];

// Must all be VERIFIED (kaprodi_status) before Kaprodi can mark VALID
const KAPRODI_REQUIRED_FILE_TYPES = KAPRODI_FILE_TYPES.filter(
  (t) =>
    !SYSTEM_FILE_TYPES.includes(t) && !KAPRODI_OPTIONAL_FILE_TYPES.includes(t),
);

// A Seminar Bisnis Digital has its own, shorter list: Kaprodi checks the proposal (stored as
// BERKAS_SKRIPSI), Sekretariat the rest (REKAP_NILAI holds the Data Perkembangan Akademik); the
// Kartu Penulisan and the Seminar SK are attached by the system.
const SEMINAR_KAPRODI_FILE_TYPES = ["BERKAS_SKRIPSI"];
const SEMINAR_SEKRETARIAT_FILE_TYPES = [
  "PAS_FOTO",
  "KTM",
  "BUKTI_PEMBAYARAN",
  "REKAP_NILAI",
];

const VALID_SIDANG_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEED_REVISION",
  "VERIFIED",
  "WAITING_FOR_DISPOSISI",
  "WAITING_FOR_SURAT",
  "COMPLETED",
  "REJECTED",
];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

async function getActiveSidang(conn, skripsiId) {
  return getActivePengajuanSidang(
    conn,
    skripsiId,
    await resolveJenis(conn, skripsiId),
  );
}

// The Surat Permohonan Seminar: generated at Kaprodi submit with the disposisi half blank, and
// regenerated at disposisi with it filled in and signed by Kaprodi. Kept in the slot of the
// Skripsi's Lembar Permohonan Ujian.
async function storePermohonanSeminar(conn, skripsiId, pengajuanSidangId, kaprodi, { disposisi = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT s.npm, s.judul, m.nama AS nama_mahasiswa, ps.nama AS prodi_nama,
            ps.kaprodi_staff_usr_id, staf.nama AS nama_kaprodi,
            u.signature_image AS mahasiswa_sig, dp.nama AS penguji_nama
     FROM skripsi s
     JOIN mahasiswa m ON m.npm = s.npm
     JOIN program_studi ps ON ps.id = s.program_studi_id
     LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
     LEFT JOIN users u ON u.npm = s.npm AND u.is_active = 1
     LEFT JOIN dosen dp ON dp.nidn = ?
     WHERE s.id = ? LIMIT 1`,
    [kaprodi.penguji1_nidn ?? null, skripsiId],
  );
  const kaprodiSig = disposisi
    ? await getStaffSignature(conn, row.kaprodi_staff_usr_id)
    : null;
  assertSignatures([
    { role: "Mahasiswa", nama: row.nama_mahasiswa, signatureImage: row.mahasiswa_sig },
    ...(disposisi
      ? [{ role: "Kaprodi", nama: row.nama_kaprodi, signatureImage: kaprodiSig }]
      : []),
  ]);

  const tanggalSidang = disposisi && kaprodi.tanggal_sidang ? new Date(kaprodi.tanggal_sidang) : null;
  const buffer = await generatePermohonanSeminarProposalFTI({
    // The letter stays dated the day the student submitted it.
    tanggal: formatTanggal(disposisi && kaprodi.submitted_at ? new Date(kaprodi.submitted_at) : new Date()),
    programStudi: row.prodi_nama,
    mahasiswa: {
      nama: row.nama_mahasiswa,
      npm: row.npm,
      tempatTanggalLahir: `${kaprodi.tempat_lahir ?? ""}, ${kaprodi.tgl_lahir ? formatTanggal(new Date(kaprodi.tgl_lahir)) : ""}`,
      alamat: kaprodi.alamat ?? "",
      noHp: kaprodi.no_hp ?? "",
      noWa: kaprodi.no_wa ?? "",
      judulSkripsi: row.judul ?? "",
      signatureBase64: row.mahasiswa_sig,
    },
    ketuaProgramStudi: { nama: row.nama_kaprodi ?? "", signatureBase64: kaprodiSig },
    disposisi: {
      tanggalDisposisi:
        disposisi && kaprodi.tanggal_disposisi ? formatTanggal(new Date(kaprodi.tanggal_disposisi)) : "",
      penguji: disposisi ? (row.penguji_nama ?? "") : "",
      hariTanggal: tanggalSidang
        ? `${tanggalSidang.toLocaleDateString("id-ID", { weekday: "long" })}, ${formatTanggal(tanggalSidang)}`
        : "",
      waktu: disposisi ? formatWaktuSidang(kaprodi.waktu_sidang, 90) : "",
    },
  });

  await conn.query(
    `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_PERMOHONAN_UJIAN'`,
    [pengajuanSidangId],
  );
  await conn.query(
    `INSERT INTO pengajuan_sidang_files
       (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, 'LEMBAR_PERMOHONAN_UJIAN', ?, 'application/pdf', ?, 'SYSTEM', 'VERIFIED')`,
    [
      pengajuanSidangId,
      `Surat_Permohonan_Seminar_${row.npm}.pdf`,
      Buffer.from(buffer).toString("base64"),
    ],
  );
}

// Read endpoints only: ?jenis= shows a finished phase (the Seminar pengajuan after the switch to Skripsi).
async function getSidangForRead(skripsiId, requestedJenis) {
  return getActivePengajuanSidang(
    db,
    skripsiId,
    await resolveReadJenis(db, skripsiId, requestedJenis),
  );
}

// These records hold KTM, pas foto, address and phone numbers, so reads are limited to
// the owning student, Sekretariat, and the Kaprodi of the skripsi's prodi.
async function canReadPengajuanSidang(req, skripsiId) {
  const [[skripsi]] = await db.query(
    `SELECT npm, program_studi_id FROM skripsi WHERE id = ? LIMIT 1`,
    [skripsiId],
  );
  if (!skripsi) return false;
  if (req.user.hasRole("SEKRETARIAT")) return true;
  if (req.user.hasRole("KAPRODI")) {
    return isKaprodiOfProgramStudi(req.user.id, skripsi.program_studi_id);
  }
  if (req.user.hasRole("STUDENT")) {
    return (await getStudentNpm(req.user.id)) === skripsi.npm;
  }
  return false;
}

async function isSkripsiOwnedBy(queryable, skripsiId, npm) {
  if (!npm) return false;
  const [[row]] = await queryable.query(
    `SELECT id FROM skripsi WHERE id = ? AND npm = ? LIMIT 1`,
    [skripsiId, npm],
  );
  return !!row;
}

// The consultation-completion auto-init can create an original sidang draft
// before an administrator opens a submission period. Attach that period at
// the student's first eligible submission without changing a prior assignment.
async function attachOpenSidangPeriodIfMissing(conn, sidang, openPeriod) {
  if (
    Number(sidang.ujian_ke) !== 1 ||
    sidang.sidang_submission_period_id != null
  ) {
    return { attached: false, period: null };
  }

  const period =
    openPeriod === undefined
      ? await getSidangOpenPeriod(sidang.jenis)
      : openPeriod;
  if (!period) return { attached: false, period: null };

  await conn.query(
    `UPDATE pengajuan_sidang
     SET sidang_submission_period_id = ?
     WHERE id = ?
       AND ujian_ke = 1
       AND sidang_submission_period_id IS NULL`,
    [period.id, sidang.id],
  );
  return { attached: true, period };
}

exports.initPengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can initialize Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const jenis = await resolveJenis(conn, skripsiId);

    const skripsiRow = await getSkripsiReadyForSidang(
      conn,
      skripsiId,
      npm,
      jenis,
    );
    if (!skripsiRow) {
      return res
        .status(400)
        .json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }
    const registrationBlock = await getSkripsiRegistrationBlock(
      conn,
      skripsiId,
      jenis,
    );
    if (registrationBlock) {
      return res.status(409).json({ ok: false, message: registrationBlock });
    }

    // Determine if this is an ujian ulang (re-exam) or original sidang
    const latestSidang = await getLatestSidang(conn, skripsiId, jenis);
    const isUjianUlang = !!(
      latestSidang && latestSidang.hasil_sidang === "TIDAK_LULUS"
    );

    if (isUjianUlang) {
      // Ujian ulang: prerequisite is the failed sidang's revisi_pasca_sidang completed
      const [[revisiRow]] = await conn.query(
        `SELECT id, is_completed FROM revisi_pasca_sidang WHERE sidang_id = ? LIMIT 1`,
        [latestSidang.id],
      );
      if (!revisiRow || !revisiRow.is_completed) {
        return res
          .status(400)
          .json({ ok: false, message: "Revisi pasca sidang belum selesai" });
      }
    } else {
      // Original flow: Kaprodi form must be VALID
      const [[latestSidangForKaprodi]] = await conn.query(
        `SELECT id FROM pengajuan_sidang WHERE skripsi_id = ? AND jenis = ? ORDER BY id DESC LIMIT 1`,
        [skripsiId, jenis],
      );
      const [[kaprodiRow]] = latestSidangForKaprodi
        ? await conn.query(
            `SELECT id, status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
            [latestSidangForKaprodi.id],
          )
        : [[null]];
      if (!kaprodiRow || kaprodiRow.status !== "VALID") {
        return res
          .status(400)
          .json({ ok: false, message: "Pengajuan ke Kaprodi belum disetujui" });
      }
    }

    // Block if there is already an active (non-terminal) pengajuan_sidang.
    // WAITING_FOR_DISPOSISI and WAITING_FOR_SURAT are in-progress, not terminal,
    // so they must also prevent creating a new row.
    const [[activeRow]] = await conn.query(
      `SELECT id, status, submitted_at FROM pengajuan_sidang
       WHERE skripsi_id = ? AND jenis = ? AND status NOT IN ('COMPLETED','REJECTED')
       ORDER BY
         CASE WHEN status = 'DRAFT' AND submitted_at IS NULL THEN 0 ELSE 1 END ASC,
         created_at DESC
       LIMIT 1`,
      [skripsiId, jenis],
    );

    await conn.beginTransaction();
    txStarted = true;

    let sidangId;
    let isNew = false;

    if (activeRow) {
      // System auto-created a DRAFT (original flow) — reuse it if not yet submitted
      if (
        activeRow.status === "DRAFT" &&
        !activeRow.submitted_at &&
        !isUjianUlang
      ) {
        sidangId = activeRow.id;
      } else {
        // Row exists and is in-progress (SUBMITTED, WAITING_FOR_DISPOSISI, etc.) — return idempotently
        await conn.rollback();
        txStarted = false;
        return res.status(200).json({
          ok: true,
          message: "Pengajuan Sidang sudah ada",
          data: { id: activeRow.id },
        });
      }
    } else {
      const ujianKe = (await countSidang(conn, skripsiId, jenis)) + 1;

      // Gate by period for original flow only (ujian ulang is exempt)
      let sidangPeriodId = null;
      if (!isUjianUlang) {
        const openPeriod = await getSidangOpenPeriod(jenis);
        if (!openPeriod) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
          });
        }
        sidangPeriodId = openPeriod.id;
      }

      const [ins] = await conn.query(
        `INSERT INTO pengajuan_sidang (skripsi_id, jenis, status, ujian_ke, sidang_submission_period_id) VALUES (?, ?, 'DRAFT', ?, ?)`,
        [skripsiId, jenis, ujianKe, sidangPeriodId],
      );
      sidangId = ins.insertId;
      isNew = true;
    }

    if (!isUjianUlang) {
      // Original flow: auto-pull system files
      const [[kartuSkripsi]] = await conn.query(
        `SELECT k.id, k.file_content, k.file_name FROM kartu_konsultasi_skripsi k WHERE k.skripsi_id = ? LIMIT 1`,
        [skripsiId],
      );
      if (!kartuSkripsi) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: "Kartu konsultasi skripsi tidak ditemukan",
        });
      }
      if (!kartuSkripsi.file_content) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: "File kartu konsultasi skripsi belum digenerate",
        });
      }
      await attachSidangSystemFiles(conn, sidangId, skripsiId);
      const [[skAttached]] = await conn.query(
        `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SK_PENUNJUKAN_PEMBIMBING' LIMIT 1`,
        [sidangId],
      );
      if (!skAttached) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(400)
          .json({ ok: false, message: "File SK Pembimbing tidak ditemukan" });
      }
    }
    // Ujian ulang: no system files auto-pulled; student uploads only BUKTI_PEMBAYARAN + BERKAS_SKRIPSI

    await conn.commit();
    txStarted = false;

    if (!isNew) {
      return res.status(200).json({
        ok: true,
        message: "Pengajuan Sidang sudah ada",
        data: { id: sidangId },
      });
    }
    return res.status(201).json({
      ok: true,
      message: "Pengajuan Sidang dibuat",
      data: { id: sidangId },
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

exports.getPengajuanSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    if (!(await canReadPengajuanSidang(req, skripsiId))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const sidang = await getSidangForRead(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[mahasiswaInfo]] = await db.query(
      `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks, s.program_studi_id,
              ps.nama AS program_studi_nama, s.perlu_surat_pengantar
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       WHERE s.id = ? LIMIT 1`,
      [skripsiId],
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, kaprodi_verified_at, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({
      ok: true,
      data: {
        sidang,
        mahasiswa: mahasiswaInfo ?? null,
        files,
        currentJenis: await resolveJenis(db, skripsiId),
        pengujiRule: await getPengujiRule(db, skripsiId, sidang.jenis),
        skripsiRegistrationBlock: await getSkripsiRegistrationBlock(
          db,
          skripsiId,
          sidang.jenis,
        ),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.uploadFiles = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({ ok: false, message: "Only students can upload files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }

    for (const f of files) {
      if (!f?.fileType || !ALL_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f?.fileType}. Harus salah satu dari: ${ALL_FILE_TYPES.join(", ")}`,
        });
      }
      if (SYSTEM_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `${f.fileType} adalah file sistem dan tidak dapat diunggah secara manual`,
        });
      }
      if (!f?.fileContent || !String(f.fileContent).trim()) {
        return res.status(400).json({
          ok: false,
          message: `fileContent wajib diisi untuk ${f.fileType}`,
        });
      }
      if (!f?.fileName || !String(f.fileName).trim()) {
        return res.status(400).json({
          ok: false,
          message: `fileName wajib diisi untuk ${f.fileType}`,
        });
      }
    }

    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!(await isSkripsiOwnedBy(db, skripsiId, npm))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const sidang = await getActiveSidang(db, skripsiId);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    const registrationBlock = await getSkripsiRegistrationBlock(
      db,
      skripsiId,
      sidang.jenis,
    );
    if (registrationBlock) {
      return res.status(409).json({ ok: false, message: registrationBlock });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message:
          "File hanya bisa diunggah saat status DRAFT atau NEED_REVISION",
      });
    }

    const [[kaprodiRow]] = sidang
      ? await db.query(
          `SELECT status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
          [sidang.id],
        )
      : [[null]];

    const isSeminar = sidang.jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
    if (isSeminar) {
      const notForSeminar = files.filter(
        (f) =>
          !SEMINAR_KAPRODI_FILE_TYPES.includes(f.fileType) &&
          !SEMINAR_SEKRETARIAT_FILE_TYPES.includes(f.fileType),
      );
      if (notForSeminar.length > 0) {
        return res.status(400).json({
          ok: false,
          message: `File berikut bukan berkas seminar proposal: ${notForSeminar.map((f) => f.fileType).join(", ")}`,
        });
      }
    }

    const kaprodiNotYetValid = kaprodiRow && kaprodiRow.status !== "VALID";
    if (kaprodiNotYetValid) {
      const uploadableBeforeValid = isSeminar
        ? SEMINAR_KAPRODI_FILE_TYPES
        : [...KAPRODI_REQUIRED_FILE_TYPES, ...KAPRODI_OPTIONAL_FILE_TYPES];
      const forbidden = files.filter(
        (f) => !uploadableBeforeValid.includes(f.fileType),
      );
      if (forbidden.length > 0) {
        return res.status(400).json({
          ok: false,
          message: `File berikut belum bisa diunggah sebelum Kaprodi menyetujui: ${forbidden.map((f) => f.fileType).join(", ")}`,
        });
      }
    }

    const conn = await db.getConnection();
    let txStarted = false;
    try {
      await conn.beginTransaction();
      txStarted = true;

      for (const f of files) {
        const [[existing]] = await conn.query(
          `SELECT kaprodi_status, kaprodi_verified_at FROM pengajuan_sidang_files
           WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
          [sidang.id, f.fileType],
        );
        // A file re-uploaded after Kaprodi verified it is no longer guaranteed
        // to match what was reviewed — keep the VERIFIED record (for history)
        // but null kaprodi_verified_at so it renders as stale, not silently
        // as unverified. Kaprodi's overall VALID gate is untouched.
        const carryKaprodiStatus = existing?.kaprodi_status ?? null;
        const carryVerifiedAt =
          existing?.kaprodi_status === "VERIFIED"
            ? null
            : (existing?.kaprodi_verified_at ?? null);

        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ?`,
          [sidang.id, f.fileType],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status, kaprodi_status, kaprodi_verified_at)
           VALUES (?, ?, ?, ?, ?, 'UPLOADED', 'SUBMITTED', ?, ?)`,
          [
            sidang.id,
            f.fileType,
            String(f.fileName).trim(),
            f.mimeType ?? null,
            String(f.fileContent),
            carryKaprodiStatus,
            carryVerifiedAt,
          ],
        );
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

    const [updatedFiles] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, kaprodi_verified_at, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({
      ok: true,
      message: "File berhasil diunggah",
      data: { files: updatedFiles },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitPengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can submit Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }
    if (!(await isSkripsiOwnedBy(conn, skripsiId, npm))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const jenis = await resolveJenis(conn, skripsiId);
    const registrationBlock = await getSkripsiRegistrationBlock(
      conn,
      skripsiId,
      jenis,
    );
    if (registrationBlock) {
      return res.status(409).json({ ok: false, message: registrationBlock });
    }

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getEditablePengajuanSidang(conn, skripsiId, jenis, {
      forUpdate: true,
    });
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    // Gate original first submissions by period, and repair legacy/auto-created
    // drafts that predate an open period by assigning it once.
    const requiresOpenPeriod =
      sidang.ujian_ke === 1 &&
      (sidang.status === "DRAFT" || sidang.sidang_submission_period_id == null);
    if (requiresOpenPeriod) {
      const openPeriod = await getSidangOpenPeriod(jenis);
      if (!openPeriod) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
        });
      }
      await attachOpenSidangPeriodIfMissing(conn, sidang, openPeriod);
    }

    const [[skripsiForSubmit]] = await conn.query(
      `SELECT perlu_surat_pengantar FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    const isSeminar = sidang.jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
    const perluSuratKeterangan =
      !isSeminar && skripsiForSubmit?.perlu_surat_pengantar === 1;

    // Validate required files are present
    const [existingFiles] = await conn.query(
      `SELECT file_type FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
      [sidang.id],
    );
    const existingTypes = new Set(existingFiles.map((f) => f.file_type));

    if (sidang.ujian_ke > 1) {
      // Ujian ulang: only BUKTI_PEMBAYARAN and BERKAS_SKRIPSI required
      const ujianUlangRequired = ["BUKTI_PEMBAYARAN", "BERKAS_SKRIPSI"];
      const missing = ujianUlangRequired.filter((t) => !existingTypes.has(t));
      if (missing.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File berikut belum diunggah: ${missing.join(", ")}`,
        });
      }
    } else {
      // Original flow: all required uploads must be present
      const requiredUploads = isSeminar
        ? [...SEMINAR_KAPRODI_FILE_TYPES, ...SEMINAR_SEKRETARIAT_FILE_TYPES]
        : REQUIRED_FILE_TYPES.filter((t) => !SYSTEM_FILE_TYPES.includes(t));
      const missingUploads = requiredUploads.filter(
        (t) => !existingTypes.has(t),
      );
      if (missingUploads.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File berikut belum diunggah: ${missingUploads.join(", ")}`,
        });
      }
      if (perluSuratKeterangan && !existingTypes.has("SURAT_KETERANGAN")) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(400)
          .json({ ok: false, message: "File SURAT_KETERANGAN belum diunggah" });
      }
    }

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    const [[mahasiswaRow]] = await conn.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRow?.nama ?? npm;
    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'SEKRETARIAT'`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn,
        sek.id,
        "SIDANG_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan Sidang Skripsi`,
        "/sekretariat/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan Sidang berhasil disubmit",
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

exports.reviewFile = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can review files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const fileType = req.params.fileType;
    if (!ALL_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid: ${fileType}`,
      });
    }

    const { status } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }
    const jenis = await resolveJenis(conn, skripsiId);

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getEditablePengajuanSidang(conn, skripsiId, jenis, {
      forUpdate: true,
    });
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED" && sidang.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Review file hanya bisa dilakukan saat status SUBMITTED atau NEED_REVISION",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_files SET status = ? WHERE id = ?`,
      [status, fileRow.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `Status file ${fileType} diperbarui`,
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

exports.finalizePengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can finalize Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const { action, catatanSekretariat } = req.body ?? {};
    if (
      action !== "VERIFY" &&
      action !== "REJECT" &&
      action !== "NEED_REVISION"
    ) {
      return res.status(400).json({
        ok: false,
        message: "action harus 'VERIFY', 'REJECT', atau 'NEED_REVISION'",
      });
    }
    if (
      (action === "REJECT" || action === "NEED_REVISION") &&
      (!catatanSekretariat || !String(catatanSekretariat).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }
    const jenis = await resolveJenis(conn, skripsiId);

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getEditablePengajuanSidang(conn, skripsiId, jenis, {
      forUpdate: true,
    });
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus SUBMITTED untuk difinalisasi",
      });
    }

    const [[kaprodiRow]] = await conn.query(
      `SELECT status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!kaprodiRow || kaprodiRow.status !== "VALID") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan sidang belum divalidasi oleh Kaprodi.",
      });
    }

    if (action === "NEED_REVISION") {
      await conn.query(
        `UPDATE pengajuan_sidang
         SET status = 'NEED_REVISION',
             catatan_sekretariat = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), sidang.id],
      );
      const [[studentRow]] = await conn.query(
        `SELECT u.id FROM users u
         JOIN skripsi s ON s.npm = u.npm
         WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
        [skripsiId],
      );
      if (studentRow) {
        await insertNotification(
          conn,
          studentRow.id,
          "SIDANG_NEED_REVISION",
          "Sekretariat meminta Anda mengunggah ulang dokumen pengajuan sidang",
          "/student/pengajuan-sidang",
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Pengajuan Sidang dikembalikan untuk revisi",
      });
    }

    if (action === "VERIFY") {
      // All required files must be VERIFIED
      const [fileRows] = await conn.query(
        `SELECT file_type, status FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
        [sidang.id],
      );
      const fileMap = Object.fromEntries(
        fileRows.map((f) => [f.file_type, f.status]),
      );

      if (sidang.ujian_ke > 1) {
        // Ujian ulang: only check BUKTI_PEMBAYARAN and BERKAS_SKRIPSI
        const ujianUlangRequired = ["BUKTI_PEMBAYARAN", "BERKAS_SKRIPSI"];
        const unverified = ujianUlangRequired.filter(
          (t) => fileMap[t] !== "VERIFIED",
        );
        if (unverified.length > 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
          });
        }
      } else {
        const [[skripsiForVerify]] = await conn.query(
          `SELECT perlu_surat_pengantar FROM skripsi WHERE id = ? LIMIT 1`,
          [skripsiId],
        );
        const isSeminar = sidang.jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
        const perluSuratKeterangan =
          !isSeminar && skripsiForVerify?.perlu_surat_pengantar === 1;

        // The Seminar proposal is Kaprodi's to check, so Sekretariat only answers for the rest.
        const sekretariatFileTypes = isSeminar
          ? SEMINAR_SEKRETARIAT_FILE_TYPES
          : REQUIRED_FILE_TYPES.filter((t) => !SYSTEM_FILE_TYPES.includes(t));
        const unverified = sekretariatFileTypes.filter(
          (t) => fileMap[t] !== "VERIFIED",
        );
        if (unverified.length > 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
          });
        }
        if (
          perluSuratKeterangan &&
          fileMap["SURAT_KETERANGAN"] !== "VERIFIED"
        ) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: "File SURAT_KETERANGAN belum diverifikasi",
          });
        }
      }

      await conn.query(
        `UPDATE pengajuan_sidang
         SET status = 'WAITING_FOR_DISPOSISI',
             catatan_sekretariat = ?,
             verified_by_user_id = ?,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          catatanSekretariat ? String(catatanSekretariat).trim() : null,
          req.user.id,
          sidang.id,
        ],
      );

      // Notify mahasiswa
      const [[studentRow]] = await conn.query(
        `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
         WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
        [skripsiId],
      );
      if (studentRow) {
        await insertNotification(
          conn,
          studentRow.id,
          "SIDANG_WAITING_FOR_DISPOSISI",
          "Dokumen pengajuan sidang telah diverifikasi. Menunggu disposisi dari Kaprodi.",
          "/student/pengajuan-sidang",
        );
      }

      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Pengajuan Sidang berhasil diverifikasi",
      });
    }

    // REJECT
    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'REJECTED',
           catatan_sekretariat = ?,
           verified_by_user_id = ?,
           verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [String(catatanSekretariat).trim(), req.user.id, sidang.id],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_REJECTED",
        "Pengajuan Sidang Skripsi Anda ditolak",
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, message: "Pengajuan Sidang ditolak" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const fileType = req.params.fileType;
    if (!ALL_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid: ${fileType}`,
      });
    }
    if (!(await canReadPengajuanSidang(req, skripsiId))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const sidang = await getSidangForRead(skripsiId, req.query?.jenis);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[file]] = await db.query(
      `SELECT id, file_type, file_name, mime_type, file_content, source, status, kaprodi_status, kaprodi_verified_at, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ? AND file_type = ?
       ORDER BY created_at DESC LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

exports.listForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const programStudiIdParam = Number(req.query?.programStudiId);
    const filterByStatus =
      statusParam && VALID_SIDANG_STATUSES.includes(statusParam);
    const filterByProdi =
      Number.isFinite(programStudiIdParam) && programStudiIdParam > 0;

    const conditions = ["ps.status != 'DRAFT'"];
    const params = [];
    if (filterByStatus) {
      conditions.push("ps.status = ?");
      params.push(statusParam);
    }
    if (filterByProdi) {
      conditions.push("sk.program_studi_id = ?");
      params.push(programStudiIdParam);
    }
    // Optional ?jenis=SKRIPSI|SEMINAR_BISNIS_DIGITAL; omitted lists both.
    if (["SKRIPSI", "SEMINAR_BISNIS_DIGITAL"].includes(req.query?.jenis)) {
      conditions.push("ps.jenis = ?");
      params.push(req.query.jenis);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await db.query(
      `SELECT
         ps.id,
         ps.skripsi_id,
         ps.jenis,
         ps.status,
         ps.catatan_sekretariat,
         ps.submitted_at,
         ps.verified_at,
         ps.created_at,
         m.nama AS nama_mahasiswa,
         sk.npm,
         sk.program_studi_id,
         prog.nama AS program_studi_nama,
         COALESCE(lanjutan.judul_seminar, sk.judul) AS judul_skripsi
       FROM pengajuan_sidang ps
       LEFT JOIN skripsi sk ON sk.id = ps.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN sidang sd ON sd.pengajuan_sidang_id = ps.id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = sd.id
       ${whereClause}
       ORDER BY ps.submitted_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Pengajuan Sidang Kaprodi ────────────────────────────────────────────────

exports.initKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can initialize Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const jenis = await resolveJenis(conn, skripsiId);

    if (!(await getSkripsiReadyForSidang(conn, skripsiId, npm, jenis))) {
      return res
        .status(400)
        .json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }
    const registrationBlock = await getSkripsiRegistrationBlock(
      conn,
      skripsiId,
      jenis,
    );
    if (registrationBlock) {
      return res.status(409).json({ ok: false, message: registrationBlock });
    }

    // Find the current active pengajuan_sidang for this student
    let [[activeSidang]] = await conn.query(
      `SELECT id, ujian_ke, status FROM pengajuan_sidang
       WHERE skripsi_id = ? AND jenis = ? AND status NOT IN ('COMPLETED','REJECTED')
       ORDER BY id DESC LIMIT 1`,
      [skripsiId, jenis],
    );

    // Check if a kaprodi row already exists for this specific pengajuan_sidang
    if (activeSidang) {
      const [[existingForSidang]] = await conn.query(
        `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
        [activeSidang.id],
      );
      if (existingForSidang) {
        // Rows auto-created by konsultasi skripsi completion before system files were
        // attached there never got them, since this early return skipped the attach below.
        if (activeSidang.ujian_ke === 1 && activeSidang.status === "DRAFT") {
          await conn.beginTransaction();
          txStarted = true;
          await attachSidangSystemFiles(conn, activeSidang.id, skripsiId);
          await conn.commit();
          txStarted = false;
        }
        return res.status(200).json({
          ok: true,
          message: "Pengajuan Sidang Kaprodi sudah ada",
          data: { id: existingForSidang.id },
        });
      }
    }

    // Guard: if the entire flow is already COMPLETED (no active sidang exists but a
    // completed one does with a linked kaprodi row), return the existing kaprodi id
    // instead of creating a spurious new DRAFT pengajuan_sidang.
    if (!activeSidang) {
      const [[completedSidang]] = await conn.query(
        `SELECT id FROM pengajuan_sidang WHERE skripsi_id = ? AND jenis = ? AND status = 'COMPLETED' ORDER BY id DESC LIMIT 1`,
        [skripsiId, jenis],
      );
      if (completedSidang) {
        const [[existingKaprodi]] = await conn.query(
          `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
          [completedSidang.id],
        );
        if (existingKaprodi) {
          return res.status(200).json({
            ok: true,
            message: "Pengajuan Sidang Kaprodi sudah ada",
            data: { id: existingKaprodi.id },
          });
        }
      }
    }

    const isUjianUlang = activeSidang && activeSidang.ujian_ke > 1;

    // Gate by period for original flow only (ujian ulang is exempt)
    let openPeriod = null;
    if (!isUjianUlang) {
      openPeriod = await getSidangOpenPeriod(jenis);
      if (!openPeriod) {
        return res.status(409).json({
          ok: false,
          message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
        });
      }
    }

    await conn.beginTransaction();
    txStarted = true;

    // Auto-create pengajuan_sidang DRAFT if missing (auto-init from konsultasi may have been skipped)
    if (!activeSidang) {
      const [sidangIns] = await conn.query(
        `INSERT INTO pengajuan_sidang (skripsi_id, jenis, status, ujian_ke, sidang_submission_period_id) VALUES (?, ?, 'DRAFT', 1, ?)`,
        [skripsiId, jenis, openPeriod?.id ?? null],
      );
      activeSidang = { id: sidangIns.insertId, ujian_ke: 1 };
    }

    const [ins] = await conn.query(
      `INSERT INTO pengajuan_sidang_kaprodi (pengajuan_sidang_id, status) VALUES (?, 'DRAFT')`,
      [activeSidang.id],
    );

    if (!isUjianUlang) {
      await attachSidangSystemFiles(conn, activeSidang.id, skripsiId);
    }
    // Ujian ulang: no system files; student has already uploaded BUKTI_PEMBAYARAN + BERKAS_SKRIPSI

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Pengajuan Sidang Kaprodi dibuat",
      data: { id: ins.insertId },
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

exports.getKaprodi = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    if (!(await canReadPengajuanSidang(req, skripsiId))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const activeSidangForGet = await getSidangForRead(skripsiId, req.query?.jenis);
    if (!activeSidangForGet) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang tidak ditemukan",
      });
    }
    const [[kaprodi]] = await db.query(
      `SELECT psk.*,
              dpg1.nama AS penguji1_nama,
              dpg2.nama AS penguji2_nama
       FROM pengajuan_sidang_kaprodi psk
       LEFT JOIN dosen dpg1 ON dpg1.nidn = psk.penguji1_nidn
       LEFT JOIN dosen dpg2 ON dpg2.nidn = psk.penguji2_nidn
       WHERE psk.pengajuan_sidang_id = ? LIMIT 1`,
      [activeSidangForGet.id],
    );
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    const [[autoData]] = await db.query(
      `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks, s.program_studi_id,
              ps.nama AS program_studi_nama,
              COALESCE(
                (SELECT l.judul_seminar FROM pengajuan_sk_skripsi_lanjutan l
                 JOIN sidang sd ON sd.id = l.seminar_sidang_id
                 WHERE sd.pengajuan_sidang_id = ?),
                s.judul
              ) AS judul_skripsi,
              s.pembimbing1_nidn, d1.nama AS pembimbing1_nama,
              s.pembimbing2_nidn, d2.nama AS pembimbing2_nama,
              COALESCE(psd.ujian_ke, 0) AS ujian_ke,
              m.tempat_lahir, m.tanggal_lahir, m.ipk
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang psd ON psd.skripsi_id = s.id
         AND psd.jenis = ?
         AND psd.status NOT IN ('REJECTED')
       WHERE s.id = ?
       ORDER BY psd.id DESC LIMIT 1`,
      [activeSidangForGet.id, activeSidangForGet.jenis, skripsiId],
    );

    const tahunMasuk = autoData?.npm
      ? "20" + String(autoData.npm).substring(0, 2)
      : null;

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, kaprodi_verified_at, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ? AND file_type IN (?)
       ORDER BY file_type ASC`,
      [activeSidangForGet.id, KAPRODI_FILE_TYPES],
    );

    return res.json({
      ok: true,
      data: {
        kaprodi: { ...kaprodi, ujian_ke: activeSidangForGet.ujian_ke ?? null },
        auto: autoData
          ? {
              npm: autoData.npm,
              nama_mahasiswa: autoData.nama_mahasiswa,
              tempat_lahir: autoData.tempat_lahir,
              tanggal_lahir: autoData.tanggal_lahir,
              sks: autoData.sks,
              ipk: autoData.ipk,
              program_studi_id: autoData.program_studi_id,
              program_studi_nama: autoData.program_studi_nama,
              judul_skripsi: autoData.judul_skripsi,
              pembimbing1_nidn: autoData.pembimbing1_nidn,
              pembimbing1_nama: autoData.pembimbing1_nama,
              pembimbing2_nidn: autoData.pembimbing2_nidn,
              pembimbing2_nama: autoData.pembimbing2_nama,
              tahun_masuk: tahunMasuk,
              ujian_ke: autoData.ujian_ke,
            }
          : null,
        files,
        jenis: activeSidangForGet.jenis,
        currentJenis: await resolveJenis(db, skripsiId),
        pengujiRule: await getPengujiRule(db, skripsiId, activeSidangForGet.jenis),
        skripsiRegistrationBlock: await getSkripsiRegistrationBlock(
          db,
          skripsiId,
          activeSidangForGet.jenis,
        ),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can update Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!(await isSkripsiOwnedBy(db, skripsiId, npm))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const activeSidangForUpdate = await getActiveSidang(db, skripsiId);
    if (!activeSidangForUpdate) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang tidak ditemukan",
      });
    }
    const registrationBlock = await getSkripsiRegistrationBlock(
      db,
      skripsiId,
      activeSidangForUpdate.jenis,
    );
    if (registrationBlock) {
      return res.status(409).json({ ok: false, message: registrationBlock });
    }
    const [[kaprodi]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [activeSidangForUpdate.id],
    );
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message: "Data hanya bisa diubah saat status DRAFT atau NEED_REVISION",
      });
    }

    const {
      tempatLahir,
      tglLahir,
      alamat,
      noHp,
      noWa,
      statusPernikahan,
      ipk,
      semuaMkLulus,
      penguji1Nidn,
      penguji2Nidn,
    } = req.body ?? {};

    const pengujiRule = await getPengujiRule(
      db,
      skripsiId,
      activeSidangForUpdate.jenis,
    );
    const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== "";
    if (!pengujiRule.studentPicks && (hasValue(penguji1Nidn) || hasValue(penguji2Nidn))) {
      return res
        .status(400)
        .json({ ok: false, message: PENGUJI_BY_KAPRODI_MESSAGE });
    }
    if (!pengujiRule.hasPenguji2 && hasValue(penguji2Nidn)) {
      return res.status(400).json({ ok: false, message: SINGLE_PENGUJI_MESSAGE });
    }

    const setClauses = [];
    const params = [];

    if (tempatLahir !== undefined) {
      const tempatLahirVal = String(tempatLahir).trim();
      if (tempatLahirVal.length > 100) {
        return res.status(400).json({
          ok: false,
          message: "Tempat lahir maksimal 100 karakter",
        });
      }
      setClauses.push("tempat_lahir = ?");
      params.push(tempatLahirVal || null);
    }
    if (tglLahir !== undefined) {
      const { error: tglLahirError, value: tglLahirVal } =
        validateTglLahir(tglLahir);
      if (tglLahirError) {
        return res.status(400).json({ ok: false, message: tglLahirError });
      }
      setClauses.push("tgl_lahir = ?");
      params.push(tglLahirVal);
    }
    if (alamat !== undefined) {
      const alamatVal = String(alamat).trim();
      if (alamatVal.length > 500) {
        return res.status(400).json({
          ok: false,
          message: "Alamat maksimal 500 karakter",
        });
      }
      setClauses.push("alamat = ?");
      params.push(alamatVal || null);
    }
    if (noHp !== undefined) {
      const noHpVal = String(noHp).trim();
      if (noHpVal && !/^08[0-9]{7,13}$/.test(noHpVal)) {
        return res.status(400).json({
          ok: false,
          message: "No. HP tidak valid (harus diawali 08, 9-15 digit angka)",
        });
      }
      setClauses.push("no_hp = ?");
      params.push(noHpVal || null);
    }
    if (noWa !== undefined) {
      const noWaVal = String(noWa).trim();
      if (noWaVal && !/^08[0-9]{7,13}$/.test(noWaVal)) {
        return res.status(400).json({
          ok: false,
          message: "No. WA tidak valid (harus diawali 08, 9-15 digit angka)",
        });
      }
      setClauses.push("no_wa = ?");
      params.push(noWaVal || null);
    }
    if (statusPernikahan !== undefined) {
      setClauses.push("status_pernikahan = ?");
      params.push(
        statusPernikahan === "Belum Menikah" ||
          statusPernikahan === "Sudah Menikah"
          ? statusPernikahan
          : null,
      );
    }
    if (ipk !== undefined) {
      const ipkError = validateIpk(ipk);
      if (ipkError) {
        return res.status(400).json({ ok: false, message: ipkError });
      }
      setClauses.push("ipk = ?");
      params.push(ipk !== null && ipk !== "" ? Number(ipk) : null);
    }
    if (semuaMkLulus !== undefined) {
      setClauses.push("semua_mk_lulus = ?");
      params.push(semuaMkLulus ? 1 : 0);
    }
    if (penguji1Nidn !== undefined) {
      setClauses.push("penguji1_nidn = ?");
      params.push(String(penguji1Nidn).trim() || null);
    }
    if (penguji2Nidn !== undefined) {
      setClauses.push("penguji2_nidn = ?");
      params.push(String(penguji2Nidn).trim() || null);
    }

    if (penguji1Nidn !== undefined || penguji2Nidn !== undefined) {
      const effectivePenguji1Nidn =
        penguji1Nidn !== undefined
          ? String(penguji1Nidn).trim() || null
          : kaprodi.penguji1_nidn;
      const effectivePenguji2Nidn =
        penguji2Nidn !== undefined
          ? String(penguji2Nidn).trim() || null
          : kaprodi.penguji2_nidn;
      const [[skripsiRow]] = await db.query(
        `SELECT pembimbing1_nidn, pembimbing2_nidn, program_studi_id FROM skripsi WHERE id = ? LIMIT 1`,
        [skripsiId],
      );
      const pengujiError = validatePengujiAssignment({
        penguji1Nidn: effectivePenguji1Nidn,
        penguji2Nidn: effectivePenguji2Nidn,
        pembimbing1Nidn: skripsiRow?.pembimbing1_nidn ?? null,
        pembimbing2Nidn: skripsiRow?.pembimbing2_nidn ?? null,
      });
      if (pengujiError) {
        return res.status(400).json({ ok: false, message: pengujiError });
      }
      // Only newly chosen NIDNs here; stale saved picks are caught at submit.
      const eligibilityError = await getIneligiblePengujiMessage(
        db,
        skripsiRow?.program_studi_id,
        activeSidangForUpdate.jenis,
        {
          penguji1Nidn:
            penguji1Nidn !== undefined ? effectivePenguji1Nidn : null,
          penguji2Nidn:
            penguji2Nidn !== undefined ? effectivePenguji2Nidn : null,
        },
      );
      if (eligibilityError) {
        return res.status(400).json({ ok: false, message: eligibilityError });
      }
    }

    if (setClauses.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Tidak ada field yang diupdate" });
    }

    params.push(kaprodi.id);
    await db.query(
      `UPDATE pengajuan_sidang_kaprodi SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params,
    );

    const [[updated]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE id = ? LIMIT 1`,
      [kaprodi.id],
    );

    return res.json({
      ok: true,
      message: "Data berhasil diperbarui",
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};

exports.submitKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can submit Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }
    if (!(await isSkripsiOwnedBy(conn, skripsiId, npm))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForSubmit = await getActiveSidang(conn, skripsiId);
    const registrationBlock =
      activeSidangForSubmit &&
      (await getSkripsiRegistrationBlock(
        conn,
        skripsiId,
        activeSidangForSubmit.jenis,
      ));
    if (registrationBlock) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: registrationBlock });
    }
    const [[kaprodi]] = activeSidangForSubmit
      ? await conn.query(
          `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForSubmit.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang Kaprodi hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    const isSeminar = activeSidangForSubmit.jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
    const missingFields = [];
    if (!kaprodi.tempat_lahir) missingFields.push("tempatLahir");
    if (!kaprodi.tgl_lahir) missingFields.push("tglLahir");
    if (!kaprodi.alamat) missingFields.push("alamat");
    if (!kaprodi.no_hp) missingFields.push("noHp");
    if (!kaprodi.no_wa) missingFields.push("noWa");
    if (!isSeminar && kaprodi.ipk == null) missingFields.push("ipk");
    const pengujiRule = await getPengujiRule(
      conn,
      skripsiId,
      activeSidangForSubmit.jenis,
    );
    if (pengujiRule.studentPicks) {
      if (!kaprodi.penguji1_nidn) missingFields.push("penguji1Nidn");
      if (pengujiRule.hasPenguji2 && !kaprodi.penguji2_nidn) {
        missingFields.push("penguji2Nidn");
      }
    }
    if (!isSeminar && !kaprodi.status_pernikahan) {
      missingFields.push("statusPernikahan");
    }
    if (missingFields.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Field berikut belum diisi: ${missingFields.join(", ")}`,
      });
    }
    if (!isSeminar && !kaprodi.semua_mk_lulus) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Konfirmasi seluruh mata kuliah sudah lulus harus dicentang",
      });
    }

    const [[skripsiProdiRow]] = await conn.query(
      `SELECT program_studi_id FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    const submitEligibilityError = await getIneligiblePengujiMessage(
      conn,
      skripsiProdiRow?.program_studi_id,
      activeSidangForSubmit.jenis,
      {
        penguji1Nidn: kaprodi.penguji1_nidn,
        penguji2Nidn: kaprodi.penguji2_nidn,
      },
    );
    if (submitEligibilityError) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: submitEligibilityError });
    }

    const { period: openPeriod } = await attachOpenSidangPeriodIfMissing(
      conn,
      activeSidangForSubmit,
    );
    if (
      Number(activeSidangForSubmit.ujian_ke) === 1 &&
      activeSidangForSubmit.sidang_submission_period_id == null &&
      !openPeriod
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
      });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [kaprodi.id],
    );

    // These are Skripsi documents and agreements; the Seminar only has its own Surat Permohonan.
    if (isSeminar) {
      await storePermohonanSeminar(conn, skripsiId, activeSidangForSubmit.id, kaprodi);
    } else {
      // Generate LEMBAR_PERMOHONAN_UJIAN
      const [[docData]] = await conn.query(
        `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks,
                ps.nama AS prodi_nama, f.nama AS fakultas_nama,
                s.judul AS judul_skripsi,
                d1.nama AS dospem1_nama,
                d2.nama AS dospem2_nama,
                ps.kaprodi_staff_usr_id,
                COALESCE(staf_kaprodi.nama, d_kaprodi.nama) AS nama_kaprodi,
                u_mhs.signature_image AS mahasiswa_sig
         FROM skripsi s
         JOIN mahasiswa m ON m.npm = s.npm
         JOIN program_studi ps ON ps.id = s.program_studi_id
         LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
         LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
         LEFT JOIN fakultas f ON f.id = ps.fakultas_id
         LEFT JOIN staf staf_kaprodi ON staf_kaprodi.usr_id = ps.kaprodi_staff_usr_id
         LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
         LEFT JOIN users u_mhs ON u_mhs.npm = s.npm AND u_mhs.is_active = 1
         WHERE s.id = ? LIMIT 1`,
        [skripsiId],
      );
      if (docData) {
        docData.kaprodi_sig = await getStaffSignature(
          conn,
          docData.kaprodi_staff_usr_id,
        );
      }

      const todayDate = formatTanggal(new Date());
      const tahunMasuk = docData?.npm
        ? "20" + String(docData.npm).substring(0, 2)
        : "";
      const tglLahirFormatted = kaprodi.tgl_lahir
        ? formatTanggal(new Date(kaprodi.tgl_lahir))
        : "";
      const ttl = `${kaprodi.tempat_lahir ?? ""}, ${tglLahirFormatted}`;
      const ujianCount = activeSidangForSubmit?.ujian_ke ?? 1;
      const ujianCountString = terbilang(ujianCount);
      const namaKaprodi = docData?.nama_kaprodi ?? "";

      assertSignatures([
        {
          role: "Kaprodi",
          nama: namaKaprodi,
          signatureImage: docData?.kaprodi_sig,
        },
        {
          role: "Mahasiswa",
          nama: docData?.nama_mahasiswa,
          signatureImage: docData?.mahasiswa_sig,
        },
      ]);

      const dataPermohonanUjianSkripsiFTI = {
        tanggal: todayDate,
        mahasiswa: {
          nama: docData?.nama_mahasiswa ?? npm,
          npm: docData?.npm ?? npm,
          tempatTanggalLahir: ttl,
          programStudi: docData?.prodi_nama ?? "",
          tahunMasuk,
          alamat: kaprodi.alamat ?? "",
          noHp: kaprodi.no_hp ?? "",
          noWa: kaprodi.no_wa ?? "",
          status: kaprodi.status_pernikahan ?? "",
          judulSkripsi: docData?.judul_skripsi ?? "",
          ujianKe: `${ujianCount} (${ujianCountString})`,
          ipk: kaprodi.ipk ?? "",
          sks: docData?.sks ?? "",
          signatureBase64: docData?.mahasiswa_sig ?? null,
        },
        ketuaProgramStudi: {
          nama: namaKaprodi,
          signatureBase64: docData?.kaprodi_sig ?? null,
        },
      };
      const lembarBuffer = await generatePermohonanUjianSkripsiFTI(
        dataPermohonanUjianSkripsiFTI,
      );
      const lembarBase64 = Buffer.from(lembarBuffer).toString("base64");
      const mimeLembarPdf = "application/pdf";

      // Auto-create pengajuan_sidang DRAFT if none exists, then upsert the file
      const jenis = activeSidangForSubmit.jenis;
      let existingSidang = await getEditablePengajuanSidang(
        conn,
        skripsiId,
        jenis,
      );
      if (!existingSidang) {
        const openPeriodForFallback = await getSidangOpenPeriod(jenis);
        const [ins] = await conn.query(
          `INSERT INTO pengajuan_sidang (skripsi_id, jenis, status, sidang_submission_period_id) VALUES (?, ?, 'DRAFT', ?)`,
          [skripsiId, jenis, openPeriodForFallback?.id ?? null],
        );
        existingSidang = { id: ins.insertId };
      }

      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_PERMOHONAN_UJIAN'`,
        [existingSidang.id],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'LEMBAR_PERMOHONAN_UJIAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          existingSidang.id,
          `Lembar_Permohonan_Ujian_${npm}.pdf`,
          mimeLembarPdf,
          lembarBase64,
        ],
      );

      // Generate SURAT_PERNYATAAN_PERBAIKAN

      const dataPernyataanPerbaikanSkripsiFTI = {
        mahasiswa: {
          nama: docData?.nama_mahasiswa ?? npm,
          npm: docData?.npm ?? npm,
          alamat: kaprodi.alamat ?? "",
          noHp: kaprodi.no_hp ?? "",
          judulSkripsi: docData?.judul_skripsi ?? "",
          signatureBase64: docData?.mahasiswa_sig ?? null,
        },
        ketuaProgramStudi: {
          nama: namaKaprodi,
          programStudi: docData?.prodi_nama ?? "",
          signatureBase64: docData?.kaprodi_sig ?? null,
        },
      };
      const perbaikanBuffer = await generatePernyataanPerbaikanSkripsiFTI(
        dataPernyataanPerbaikanSkripsiFTI,
      );
      const perbaikanBase64 = Buffer.from(perbaikanBuffer).toString("base64");
      const mimePerbaikanPdf = "application/pdf";

      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_PERBAIKAN'`,
        [existingSidang.id],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'SURAT_PERNYATAAN_PERBAIKAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          existingSidang.id,
          `Surat_Pernyataan_Perbaikan_${npm}.pdf`,
          mimePerbaikanPdf,
          perbaikanBase64,
        ],
      );

      // Generate SURAT_PERNYATAAN_KELENGKAPAN

      const dataPernyataanKelengkapanDanNilaiMatkulFTI = {
        mahasiswa: {
          nama: docData?.nama_mahasiswa ?? npm,
          npm: docData?.npm ?? npm,
          programStudi: docData?.prodi_nama ?? "",
          signatureBase64: docData?.mahasiswa_sig ?? null,
        },
        tanggal: todayDate,
      };
      const kelengkapanBuffer =
        await generatePernyataanKelengkapanDanNilaiMatkulFTI(
          dataPernyataanKelengkapanDanNilaiMatkulFTI,
        );
      const kelengkapanBase64 = Buffer.from(kelengkapanBuffer).toString("base64");
      const mimeKelengkapanPdf = "application/pdf";

      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_KELENGKAPAN'`,
        [existingSidang.id],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'SURAT_PERNYATAAN_KELENGKAPAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          existingSidang.id,
          `Surat_Pernyataan_Kelengkapan_${npm}.pdf`,
          mimeKelengkapanPdf,
          kelengkapanBase64,
        ],
      );

      // Generate LEMBAR_USULAN_PENGUJI (not for Bisnis Digital, whose penguji Kaprodi assigns)
      if (pengujiRule.studentPicks) {
        const pilihanPengujiUsulan = await buildPilihanPenguji(
          conn,
          skripsiProdiRow?.program_studi_id,
          activeSidangForSubmit.jenis,
          {
            penguji1Nidn: kaprodi.penguji1_nidn,
            penguji2Nidn: kaprodi.penguji2_nidn,
          },
        );

        const dataUsulanPengujiFTI = {
          tanggal: todayDate,
          programStudi: docData?.prodi_nama ?? "",
          ketuaProgramStudi: {
            nama: namaKaprodi,
            signatureBase64: null,
          },
          mahasiswa: {
            nama: docData?.nama_mahasiswa ?? npm,
            npm: docData?.npm ?? npm,
            pembimbingUtama: docData?.dospem1_nama ?? "",
            pembimbingKedua: docData?.dospem2_nama ?? "",
            judulSkripsi: docData?.judul_skripsi ?? "",
            signatureBase64: docData?.mahasiswa_sig ?? null,
          },
          pilihanPenguji: pilihanPengujiUsulan,
          disposisi: {
            pengujiUtama: "",
            pengujiKedua: "",
            tanggalUjian: "",
            waktuUjian: "",
            tanggalDisposisi: "",
            signatureBase64: null,
          },
        };
        const usulanBuffer = await generateUsulanPengujiFTI(dataUsulanPengujiFTI);
        const usulanBase64 = Buffer.from(usulanBuffer).toString("base64");
        const mimeUsulanPdf = "application/pdf";

        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_USULAN_PENGUJI'`,
          [existingSidang.id],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'LEMBAR_USULAN_PENGUJI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
          [
            existingSidang.id,
            `Lembar_Usulan_Penguji_${npm}.pdf`,
            mimeUsulanPdf,
            usulanBase64,
          ],
        );
      }

      // Regenerate SURAT_PENYELESAIAN_SKRIPSI now that alamat and no_hp are available
      const [[skRow]] = await conn.query(
        `SELECT psk.id FROM pengajuan_sk_penelitian psk
         WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
         LIMIT 1`,
        [skripsiId],
      );
      if (skRow) {

        const dataPernyataanPenyelesaianSkripsiFTI = {
          mahasiswa: {
            nama: docData?.nama_mahasiswa ?? npm,
            npm: docData?.npm ?? npm,
            alamat: kaprodi.alamat ?? "",
            noHp: kaprodi.no_hp ?? "",
            judulSkripsi: docData?.judul_skripsi ?? "",
            signatureBase64: docData?.mahasiswa_sig ?? null,
          },
          ketuaProgramStudi: {
            nama: namaKaprodi,
            programStudi: docData?.prodi_nama ?? "",
            signatureBase64: docData?.kaprodi_sig ?? null,
          },
        };
        const penyelesaianBuffer = await generatePernyataanPenyelesaianSkripsiFTI(
          dataPernyataanPenyelesaianSkripsiFTI,
        );
        const penyelesaianBase64 =
          Buffer.from(penyelesaianBuffer).toString("base64");
        const penyelesaianFileName = `Surat_Penyelesaian_Skripsi_${npm}.pdf`;
        const mimePenyelesaianPdf = "application/pdf";

        await conn.query(
          `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SURAT_PENYELESAIAN_SKRIPSI'`,
          [skRow.id],
        );
        await conn.query(
          `INSERT INTO pengajuan_sk_penelitian_files
             (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'SURAT_PENYELESAIAN_SKRIPSI', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
          [
            skRow.id,
            penyelesaianFileName,
            mimePenyelesaianPdf,
            penyelesaianBase64,
          ],
        );
        // Also update the copy already attached to pengajuan_sidang_files
        await conn.query(
          `UPDATE pengajuan_sidang_files
           SET file_content = ?, file_name = ?, mime_type = ?, updated_at = CURRENT_TIMESTAMP
           WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYELESAIAN'`,
          [
            penyelesaianBase64,
            penyelesaianFileName,
            mimePenyelesaianPdf,
            existingSidang.id,
          ],
        );
      }
    }

    const [[mahasiswaRow]] = await conn.query(
      `SELECT m.nama, m.program_studi_id FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRow?.nama ?? npm;
    const programStudiId = mahasiswaRow?.program_studi_id;

    if (programStudiId) {
      const [kaprodiUsers] = await conn.query(
        `SELECT u.id FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
         INNER JOIN program_studi ps ON COALESCE(ps.kaprodi_nidn, ps.kaprodi_staff_usr_id) = COALESCE(u.nidn, u.staff_usr_id)
         WHERE r.code = 'KAPRODI' AND ps.id = ? AND u.is_active = 1`,
        [programStudiId],
      );
      for (const ku of kaprodiUsers) {
        await insertNotification(
          conn,
          ku.id,
          "SIDANG_KAPRODI_SUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan permohonan ${isSeminar ? "seminar proposal" : "sidang skripsi"}`,
          "/kaprodi/pengajuan-sidang",
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan Sidang Kaprodi berhasil disubmit",
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

exports.reviewFileKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can review files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const fileType = req.params.fileType;
    if (!KAPRODI_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid untuk verifikasi Kaprodi: ${fileType}`,
      });
    }

    const { status } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIds(staffUsrId);

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getActiveSidang(conn, skripsiId);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    const [[kaprodi]] = await conn.query(
      `SELECT psk.*, s.program_studi_id
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = ps.skripsi_id
       WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
      [sidang.id],
    );
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }

    if (kaprodi.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Review file hanya bisa dilakukan saat Pengajuan Sidang Kaprodi berstatus SUBMITTED",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_files
       SET kaprodi_status = ?,
           kaprodi_verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
      [status, status, fileRow.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `Status file ${fileType} diperbarui oleh Kaprodi`,
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

exports.reviewKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only kaprodi can review Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const { action, catatanKaprodi } = req.body ?? {};
    if (
      action !== "VALID" &&
      action !== "NEED_REVISION" &&
      action !== "REJECTED"
    ) {
      return res.status(400).json({
        ok: false,
        message: "action harus 'VALID', 'NEED_REVISION', atau 'REJECTED'",
      });
    }
    if (
      (action === "NEED_REVISION" || action === "REJECTED") &&
      (!catatanKaprodi || !String(catatanKaprodi).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanKaprodi wajib diisi" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIds(staffUsrId);

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForReview = await getActiveSidang(conn, skripsiId);
    const [[kaprodi]] = activeSidangForReview
      ? await conn.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForReview.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }

    if (kaprodi.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang Kaprodi harus berstatus SUBMITTED untuk direview",
      });
    }

    if (action === "VALID") {
      const sidang = activeSidangForReview;
      if (!sidang) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(409)
          .json({ ok: false, message: "Belum ada Pengajuan Sidang terkait" });
      }
      const kaprodiRequiredFileTypes =
        activeSidangForReview.jenis === JENIS.SEMINAR_BISNIS_DIGITAL
          ? SEMINAR_KAPRODI_FILE_TYPES
          : KAPRODI_REQUIRED_FILE_TYPES;
      const [fileRows] = await conn.query(
        `SELECT file_type, kaprodi_status, kaprodi_verified_at FROM pengajuan_sidang_files
         WHERE pengajuan_sidang_id = ? AND file_type IN (?)`,
        [sidang.id, kaprodiRequiredFileTypes],
      );
      const verifiedSet = new Set(
        fileRows
          .filter(
            (r) => r.kaprodi_status === "VERIFIED" && r.kaprodi_verified_at,
          )
          .map((r) => r.file_type),
      );
      const unverifiedFiles = kaprodiRequiredFileTypes.filter(
        (t) => !verifiedSet.has(t),
      );
      if (unverifiedFiles.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Semua file skripsi harus diverifikasi sebelum menyetujui",
          unverifiedFiles,
        });
      }
      const reviewEligibilityError = await getIneligiblePengujiMessage(
        conn,
        kaprodi.program_studi_id,
        activeSidangForReview.jenis,
        {
          penguji1Nidn: kaprodi.penguji1_nidn,
          penguji2Nidn: kaprodi.penguji2_nidn,
        },
      );
      if (reviewEligibilityError) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(400)
          .json({ ok: false, message: reviewEligibilityError });
      }
    }

    const newStatus = action === "VALID" ? "VALID" : action;

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = ?,
           catatan_kaprodi = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        newStatus,
        catatanKaprodi ? String(catatanKaprodi).trim() : null,
        req.user.id,
        kaprodi.id,
      ],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );

    if (studentRow) {
      const notifMap = {
        VALID: [
          "SIDANG_KAPRODI_VALID",
          "Pengajuan sidang Anda telah disetujui oleh Kaprodi",
        ],
        NEED_REVISION: [
          "SIDANG_KAPRODI_NEED_REVISION",
          "Kaprodi meminta revisi pada pengajuan sidang Anda",
        ],
        REJECTED: [
          "SIDANG_KAPRODI_REJECTED",
          "Pengajuan sidang Anda ditolak oleh Kaprodi",
        ],
      };
      const [notifType, notifMsg] = notifMap[action];
      await insertNotification(
        conn,
        studentRow.id,
        notifType,
        notifMsg,
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    const msgMap = {
      VALID: "disetujui",
      NEED_REVISION: "dikembalikan untuk revisi",
      REJECTED: "ditolak",
    };
    return res.json({
      ok: true,
      message: `Pengajuan Sidang Kaprodi ${msgMap[action]}`,
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

exports.listKaprodiSubmissions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
    if (kaprodiProgramStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const pagination = parsePagination(req.query);
    const statusParam = req.query?.status;
    const q = String(req.query?.q ?? "").trim();
    const filterByStatus =
      statusParam && VALID_KAPRODI_STATUSES.includes(statusParam);

    const tahunAkademik = req.query?.tahunAkademik
      ? String(req.query.tahunAkademik)
      : null;
    const periodeAkademik = req.query?.periodeAkademik
      ? String(req.query.periodeAkademik)
      : null;

    const conditions = [
      `ps.id IN (${kaprodiProgramStudiIds.map(() => "?").join(",")})`,
      `psk.status != 'DRAFT'`,
    ];
    const params = [...kaprodiProgramStudiIds];

    if (filterByStatus) {
      conditions.push("psk.status = ?");
      params.push(statusParam);
    }

    if (tahunAkademik) {
      conditions.push("ssp.tahun_akademik = ?");
      params.push(tahunAkademik);
    }

    if (periodeAkademik) {
      conditions.push("ssp.periode_akademik = ?");
      params.push(periodeAkademik);
    }
    // Optional ?jenis=SKRIPSI|SEMINAR_BISNIS_DIGITAL; omitted lists both.
    if (["SKRIPSI", "SEMINAR_BISNIS_DIGITAL"].includes(req.query?.jenis)) {
      conditions.push("pengajuan_sidang.jenis = ?");
      params.push(req.query.jenis);
    }
    if (q) {
      const searchValue = `%${q}%`;
      conditions.push("(m.nama LIKE ? OR s.npm LIKE ? OR s.judul LIKE ?)");
      params.push(searchValue, searchValue, searchValue);
    }

    const countJoins = `FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ON pengajuan_sidang.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = pengajuan_sidang.skripsi_id
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN sidang_submission_period ssp ON ssp.id = pengajuan_sidang.sidang_submission_period_id`;
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total ${countJoins}
       WHERE ${conditions.join(" AND ")}`,
      params,
    );

    const [rows] = await db.query(
      `SELECT
         psk.id,
         pengajuan_sidang.skripsi_id,
         pengajuan_sidang.jenis,
         psk.status,
         psk.catatan_kaprodi,
         psk.submitted_at,
         psk.reviewed_at,
         psk.created_at,
         s.npm,
         m.nama AS nama_mahasiswa,
         s.program_studi_id,
         ps.nama AS program_studi_nama,
         COALESCE(lanjutan.judul_seminar, s.judul) AS judul_skripsi,
         pengajuan_sidang.ujian_ke,
         pengajuan_sidang.sidang_submission_period_id AS submission_period_id,
         ssp.tahun_akademik AS period_tahun_akademik,
         ssp.periode_akademik AS period_periode_akademik
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ON pengajuan_sidang.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = pengajuan_sidang.skripsi_id
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN sidang_submission_period ssp ON ssp.id = pengajuan_sidang.sidang_submission_period_id
       LEFT JOIN sidang sd ON sd.pengajuan_sidang_id = pengajuan_sidang.id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = sd.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY psk.submitted_at DESC${pagination.enabled ? " LIMIT ? OFFSET ?" : ""}`,
      pagination.enabled
        ? [...params, pagination.limit, pagination.offset]
        : params,
    );

    pagination.totalItems = Number(countRow.total);
    return listResponse(res, { rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.updateDisposisi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can update disposisi" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIds(staffUsrId);

    const activeSidangForUpdate = await getActiveSidang(db, skripsiId);
    const [[kaprodi]] = activeSidangForUpdate
      ? await db.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1`,
          [activeSidangForUpdate.id],
        )
      : [[null]];
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }
    if (kaprodi.status !== "VALID" && kaprodi.status !== "DISPOSISI_SENT") {
      return res.status(409).json({
        ok: false,
        message:
          "Disposisi hanya bisa diubah saat status VALID atau DISPOSISI_SENT",
      });
    }

    const {
      tanggalSidang,
      waktuSidang,
      tempatSidang,
      tanggalDisposisi,
      penguji1Nidn,
      penguji2Nidn,
    } = req.body ?? {};

    const updates = {};
    if (tanggalSidang !== undefined)
      updates.tanggal_sidang = tanggalSidang || null;
    if (waktuSidang !== undefined) updates.waktu_sidang = waktuSidang || null;
    if (tempatSidang !== undefined)
      updates.tempat_sidang = tempatSidang ? String(tempatSidang).trim() : null;
    if (tanggalDisposisi !== undefined)
      updates.tanggal_disposisi = tanggalDisposisi || null;
    if (penguji1Nidn !== undefined)
      updates.penguji1_nidn = penguji1Nidn ? String(penguji1Nidn).trim() : null;
    if (penguji2Nidn !== undefined)
      updates.penguji2_nidn = penguji2Nidn ? String(penguji2Nidn).trim() : null;
    if (
      updates.penguji2_nidn &&
      activeSidangForUpdate.jenis === JENIS.SEMINAR_BISNIS_DIGITAL
    ) {
      return res.status(400).json({ ok: false, message: SINGLE_PENGUJI_MESSAGE });
    }

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Tidak ada field yang diubah" });
    }

    const disposisiEligibilityError = await getIneligiblePengujiMessage(
      db,
      kaprodi.program_studi_id,
      activeSidangForUpdate.jenis,
      {
        penguji1Nidn: updates.penguji1_nidn,
        penguji2Nidn: updates.penguji2_nidn,
      },
    );
    if (disposisiEligibilityError) {
      return res
        .status(400)
        .json({ ok: false, message: disposisiEligibilityError });
    }

    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const setValues = Object.values(updates);

    await db.query(
      `UPDATE pengajuan_sidang_kaprodi SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...setValues, kaprodi.id],
    );

    return res.json({ ok: true, message: "Data disposisi disimpan" });
  } catch (err) {
    next(err);
  }
};

exports.submitDisposisi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can submit disposisi" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIds(staffUsrId);

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForDisposisi = await getActiveSidang(conn, skripsiId);
    const [[kaprodi]] = activeSidangForDisposisi
      ? await conn.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForDisposisi.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }
    if (kaprodi.status !== "VALID" && kaprodi.status !== "DISPOSISI_SENT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Disposisi hanya bisa disubmit saat status VALID atau DISPOSISI_SENT",
      });
    }

    const missingDisposisi = [];
    if (!kaprodi.tanggal_sidang) missingDisposisi.push("tanggalSidang");
    if (!kaprodi.waktu_sidang) missingDisposisi.push("waktuSidang");
    if (!kaprodi.tempat_sidang) missingDisposisi.push("tempatSidang");
    if (!kaprodi.tanggal_disposisi) missingDisposisi.push("tanggalDisposisi");
    const pengujiRule = await getPengujiRule(
      conn,
      skripsiId,
      activeSidangForDisposisi.jenis,
    );
    if (!kaprodi.penguji1_nidn) missingDisposisi.push("penguji1Nidn");
    if (pengujiRule.hasPenguji2 && !kaprodi.penguji2_nidn) {
      missingDisposisi.push("penguji2Nidn");
    }
    if (missingDisposisi.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Field disposisi berikut belum diisi: ${missingDisposisi.join(", ")}`,
      });
    }
    if (!pengujiRule.hasPenguji2 && kaprodi.penguji2_nidn) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({ ok: false, message: SINGLE_PENGUJI_MESSAGE });
    }

    // Kaprodi is the only one who sets penguji for Bisnis Digital, so the pembimbing/duplicate
    // check the student's form runs must also run here.
    const [[pembimbingRow]] = await conn.query(
      `SELECT pembimbing1_nidn, pembimbing2_nidn FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    const disposisiPengujiError = validatePengujiAssignment({
      penguji1Nidn: kaprodi.penguji1_nidn,
      penguji2Nidn: kaprodi.penguji2_nidn,
      pembimbing1Nidn: pembimbingRow?.pembimbing1_nidn ?? null,
      pembimbing2Nidn: pembimbingRow?.pembimbing2_nidn ?? null,
    });
    if (disposisiPengujiError) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({ ok: false, message: disposisiPengujiError });
    }

    const sidang = await getActiveSidang(conn, skripsiId);
    if (
      !sidang ||
      !["VERIFIED", "WAITING_FOR_DISPOSISI"].includes(sidang.status)
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus WAITING_FOR_DISPOSISI sebelum mengirim disposisi",
      });
    }

    const submitDisposisiEligibilityError = await getIneligiblePengujiMessage(
      conn,
      kaprodi.program_studi_id,
      activeSidangForDisposisi.jenis,
      {
        penguji1Nidn: kaprodi.penguji1_nidn,
        penguji2Nidn: kaprodi.penguji2_nidn,
      },
    );
    if (submitDisposisiEligibilityError) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: submitDisposisiEligibilityError });
    }

    const [[docData]] = await conn.query(
      `SELECT
         s.npm, m.nama AS nama_mahasiswa,
         ps.nama AS prodi_nama,
         f.nama AS fakultas_nama,
         s.judul AS judul_skripsi,
         d1.nama AS dospem1_nama,
         d2.nama AS dospem2_nama,
         ps.kaprodi_staff_usr_id,
         COALESCE(staf_kaprodi.nama, d_kaprodi.nama) AS nama_kaprodi,
         u_mhs.signature_image AS mahasiswa_sig
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN staf staf_kaprodi ON staf_kaprodi.usr_id = ps.kaprodi_staff_usr_id
       LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
       LEFT JOIN users u_mhs ON u_mhs.npm = s.npm AND u_mhs.is_active = 1
       WHERE s.id = ? LIMIT 1`,
      [skripsiId],
    );
    if (docData) {
      docData.kaprodi_sig = await getStaffSignature(
        conn,
        docData.kaprodi_staff_usr_id,
      );
    }

    const npm = docData?.npm ?? "";
    const sidangDateFormatted = kaprodi.tanggal_sidang
      ? formatTanggal(new Date(kaprodi.tanggal_sidang))
      : "";
    const disposisiDateFormatted = kaprodi.tanggal_disposisi
      ? formatTanggal(new Date(kaprodi.tanggal_disposisi))
      : "";
    const waktuSidangFormatted = kaprodi.waktu_sidang
      ? String(kaprodi.waktu_sidang).substring(0, 5)
      : "";

    // Bisnis Digital has no Lembar Usulan Penguji, so nothing is regenerated or signed here.
    if (pengujiRule.studentPicks) {
      const [[pg1RowDisposisi]] = await conn.query(
        `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
        [kaprodi.penguji1_nidn],
      );
      const [[pg2RowDisposisi]] = await conn.query(
        `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
        [kaprodi.penguji2_nidn],
      );

      assertSignatures([
        {
          role: "Kaprodi",
          nama: docData?.nama_kaprodi,
          signatureImage: docData?.kaprodi_sig,
        },
        {
          role: "Mahasiswa",
          nama: docData?.nama_mahasiswa,
          signatureImage: docData?.mahasiswa_sig,
        },
      ]);

      const dataUsulanPengujiFTI = {
        tanggal: formatTanggal(new Date()),
        programStudi: docData?.prodi_nama ?? "",
        ketuaProgramStudi: {
          nama: docData?.nama_kaprodi ?? "",
          signatureBase64: docData?.kaprodi_sig ?? null,
        },
        mahasiswa: {
          nama: docData?.nama_mahasiswa ?? npm,
          npm,
          pembimbingUtama: docData?.dospem1_nama ?? "",
          pembimbingKedua: docData?.dospem2_nama ?? "",
          judulSkripsi: docData?.judul_skripsi ?? "",
          signatureBase64: docData?.mahasiswa_sig ?? null,
        },
        pilihanPenguji: await buildPilihanPenguji(
          conn,
          kaprodi.program_studi_id,
          activeSidangForDisposisi.jenis,
          {
            penguji1Nidn: kaprodi.penguji1_nidn,
            penguji2Nidn: kaprodi.penguji2_nidn,
          },
        ),
        disposisi: {
          pengujiUtama: pg1RowDisposisi?.nama ?? "",
          pengujiKedua: pg2RowDisposisi?.nama ?? "",
          tanggalUjian: sidangDateFormatted,
          waktuUjian: waktuSidangFormatted,
          tanggalDisposisi: disposisiDateFormatted,
          signatureBase64: docData?.kaprodi_sig ?? null,
        },
      };
      const usulanBuffer = await generateUsulanPengujiFTI(dataUsulanPengujiFTI);
      const usulanBase64 = Buffer.from(usulanBuffer).toString("base64");
      const mimeUsulanPdf = "application/pdf";

      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_USULAN_PENGUJI'`,
        [sidang.id],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'LEMBAR_USULAN_PENGUJI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          sidang.id,
          `Lembar_Usulan_Penguji_${npm}.pdf`,
          mimeUsulanPdf,
          usulanBase64,
        ],
      );
    }

    if (activeSidangForDisposisi.jenis === JENIS.SEMINAR_BISNIS_DIGITAL) {
      await storePermohonanSeminar(conn, skripsiId, activeSidangForDisposisi.id, kaprodi, {
        disposisi: true,
      });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'DISPOSISI_SENT', disposisi_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [kaprodi.id],
    );

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'WAITING_FOR_SURAT', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    const namaMahasiswa = docData?.nama_mahasiswa ?? npm;

    // Notify mahasiswa that schedule has been set and surat is pending
    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_DISPOSISI_SUBMITTED",
        "Kaprodi telah mengisi jadwal sidang. Menunggu surat undangan dari Sekretariat.",
        "/student/pengajuan-sidang",
      );
    }

    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'SEKRETARIAT'`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn,
        sek.id,
        "DISPOSISI_SIDANG_SENT",
        `Kaprodi telah mengirim disposisi penguji dan jadwal sidang untuk mahasiswa ${namaMahasiswa}`,
        "/sekretariat/disposisi-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Disposisi berhasil dikirim ke Sekretariat",
      data: {
        id: kaprodi.id,
        status: "DISPOSISI_SENT",
        disposisiSubmittedAt: new Date(),
      },
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

exports.listDisposisiForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const validDisposisiStatuses = ["VALID", "DISPOSISI_SENT", "COMPLETED"];
    const filterByStatus =
      statusParam && validDisposisiStatuses.includes(statusParam);

    const programStudiIdParam = Number(req.query?.programStudiId);
    const filterByProdi =
      Number.isFinite(programStudiIdParam) && programStudiIdParam > 0;

    const conditions = [`psk.status IN ('VALID','DISPOSISI_SENT','COMPLETED')`];
    const params = [];

    if (filterByStatus) {
      conditions[0] = `psk.status = ?`;
      params.push(statusParam);
    }
    if (filterByProdi) {
      conditions.push("s.program_studi_id = ?");
      params.push(programStudiIdParam);
    }
    // Optional ?jenis=SKRIPSI|SEMINAR_BISNIS_DIGITAL; omitted lists both.
    if (["SKRIPSI", "SEMINAR_BISNIS_DIGITAL"].includes(req.query?.jenis)) {
      conditions.push("ps2.jenis = ?");
      params.push(req.query.jenis);
    }

    const [rows] = await db.query(
      `SELECT
         ps2.id AS pengajuan_sidang_id,
         ps2.skripsi_id,
         ps2.jenis,
         m.nama AS nama_mahasiswa,
         s.npm,
         prog.nama AS program_studi_nama,
         COALESCE(lanjutan.judul_seminar, s.judul) AS judul_skripsi,
         psk.status AS kaprodi_status,
         psk.tanggal_sidang,
         psk.waktu_sidang,
         psk.tempat_sidang,
         psk.tanggal_disposisi,
         psk.penguji1_nidn,
         d_pg1.nama AS penguji1_nama,
         psk.penguji2_nidn,
         d_pg2.nama AS penguji2_nama,
         psk.disposisi_submitted_at
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ps2 ON ps2.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = ps2.skripsi_id
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi prog ON prog.id = s.program_studi_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk.penguji2_nidn
       LEFT JOIN sidang sd ON sd.pengajuan_sidang_id = ps2.id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = sd.id
       WHERE ${conditions.join(" AND ")}
         AND ps2.status IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY psk.disposisi_submitted_at DESC, psk.reviewed_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.generateSuratUndangan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can generate surat undangan",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const jenis = await resolveJenis(conn, skripsiId);

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE skripsi_id = ? AND jenis = ?
       ORDER BY
         CASE WHEN status = 'WAITING_FOR_SURAT' THEN 0 ELSE 1 END ASC,
         created_at DESC
       LIMIT 1 FOR UPDATE`,
      [skripsiId, jenis],
    );
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "WAITING_FOR_SURAT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus WAITING_FOR_SURAT untuk menghasilkan surat undangan",
      });
    }

    // Gather all data needed for the surat undangan template
    // Join pengajuan_sidang_kaprodi via pengajuan_sidang_id to handle ujian ulang (multiple rows per student)
    const [[dataRow]] = await conn.query(
      `SELECT
         s.npm,
         m.nama AS nama_mahasiswa,
         m.email AS mahasiswa_email,
         ps.id AS program_studi_id,
         ps.nama AS prodi_nama,
         ps.kode AS ps_kode,
         ps.kaprodi_staff_usr_id,
         f.nama AS fakultas_nama,
         f.kode AS f_kode,
         s.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, s.pembimbing1_nidn,
         d2.nama AS pembimbing2_nama, s.pembimbing2_nidn,
         COALESCE(skl.nomor_surat, psk.nomor_surat) AS nomor_surat,
         COALESCE(skl.completed_at, psk.verified_at) AS sk_verified_at,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama,
         psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         psk_k.tanggal_disposisi
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN pengajuan_sk_penelitian psk ON psk.outline_id = s.outline_id
       -- A Sidang Skripsi after the Seminar cites the SK Skripsi issued through the bridge.
       LEFT JOIN pengajuan_sk_skripsi_lanjutan skl
              ON skl.skripsi_id = s.id AND skl.status = 'COMPLETED' AND ? = 'SKRIPSI'
       LEFT JOIN pengajuan_sidang_kaprodi psk_k ON psk_k.pengajuan_sidang_id = ?
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.id = ?
       LIMIT 1`,
      [jenis, sidang.id, skripsiId],
    );
    // ujian_ke lives on pengajuan_sidang (already fetched as `sidang`)
    if (dataRow) dataRow.ujian_ke = sidang.ujian_ke ?? 1;

    const npm = dataRow?.npm ?? "";

    // Kaprodi signature + name
    const kaprodiStaffUserId = dataRow?.kaprodi_staff_usr_id ?? null;
    const kaprodiSignature = await getStaffSignature(conn, kaprodiStaffUserId);
    const [[kaprodiStaffRow]] = kaprodiStaffUserId
      ? await conn.query(`SELECT nama FROM staf WHERE usr_id = ? LIMIT 1`, [
          kaprodiStaffUserId,
        ])
      : [[null]];

    assertSignatures([
      {
        role: "Kaprodi",
        nama: kaprodiStaffRow?.nama,
        signatureImage: kaprodiSignature,
      },
    ]);

    // Dosen emails for pembimbing and penguji
    async function getDosenEmail(nidn) {
      if (!nidn) return null;
      const [[row]] = await conn.query(
        `SELECT email FROM dosen WHERE nidn = ? LIMIT 1`,
        [nidn],
      );
      return row?.email ?? null;
    }

    const [pembimbing1Email, pembimbing2Email, penguji1Email, penguji2Email] =
      await Promise.all([
        getDosenEmail(dataRow?.pembimbing1_nidn),
        getDosenEmail(dataRow?.pembimbing2_nidn),
        getDosenEmail(dataRow?.penguji1_nidn),
        getDosenEmail(dataRow?.penguji2_nidn),
      ]);

    // Generate nomor_surat for surat undangan (monthly sequence per prodi, resets each month).
    // Locking the prodi row serializes concurrent generations for the same prodi, and the count
    // is a locking read (FOR SHARE) so it sees letters committed while we waited for that lock —
    // a plain read would use this transaction's older snapshot and hand out a duplicate number.
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    await conn.query(`SELECT id FROM program_studi WHERE id = ? FOR UPDATE`, [
      dataRow?.program_studi_id,
    ]);
    const [[{ seq }]] = await conn.query(
      `SELECT COUNT(*) AS seq
       FROM sidang sd
       JOIN skripsi sk ON sk.id = sd.skripsi_id
       WHERE sk.program_studi_id = ?
         AND sd.jenis = ?
         AND sd.nomor_surat IS NOT NULL
         AND YEAR(sd.created_at) = ?
         AND MONTH(sd.created_at) = ?
       FOR SHARE`,
      [dataRow?.program_studi_id, jenis, year, month],
    );
    const isSeminar = jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
    const kodeSuratSidang = isSeminar ? "Seminar" : "Sidang-Skripsi";
    const nomorSuratSidang = `${String(Number(seq) + 1).padStart(3, "0")}/${dataRow?.f_kode ?? ""}/${dataRow?.ps_kode ?? ""}/${kodeSuratSidang}/${BULAN_ROMAWI[month - 1]}/${year}`;

    // Format dates
    const today = formatTanggal(new Date());
    const tanggalSk = dataRow?.sk_verified_at
      ? formatTanggal(new Date(dataRow.sk_verified_at))
      : "";
    const sidangDate = dataRow?.tanggal_sidang
      ? formatTanggal(new Date(dataRow.tanggal_sidang))
      : "";
    const sidangTime = dataRow?.waktu_sidang
      ? String(dataRow.waktu_sidang).substring(0, 5)
      : "";

    const dataSuratUndanganSidangFTI = {
      nomorSurat: nomorSuratSidang,
      lampiran: "-",
      tanggalSurat: today,
      nomorSk: dataRow?.nomor_surat ?? "",
      tanggalSk,
      mahasiswa: {
        nama: dataRow?.nama_mahasiswa ?? "",
        npm,
        programStudi: dataRow?.prodi_nama ?? "",
        judulSkripsi: dataRow?.judul_skripsi ?? "",
      },
      pengajar: {
        pembimbingPertama: dataRow?.pembimbing1_nama ?? "",
        pembimbingKedua: dataRow?.pembimbing2_nama ?? "",
        pengujiPertama: dataRow?.penguji1_nama ?? "",
        pengujiKedua: dataRow?.penguji2_nama ?? "",
      },
      tanggalSidang: sidangDate,
      waktuSidang: sidangTime,
      tempatSidang: dataRow?.tempat_sidang ?? "",
      ketuaProgramStudi: {
        nama: kaprodiStaffRow?.nama ?? "",
        signatureBase64: kaprodiSignature ?? null,
      },
    };
    const suratBuffer = isSeminar
      ? await generateSuratUndanganSeminarProposalFTI({
          ...dataSuratUndanganSidangFTI,
          pengajar: {
            pembimbingPertama: dataRow?.pembimbing1_nama ?? "",
            pembimbingKedua: dataRow?.pembimbing2_nama ?? "",
            penguji: dataRow?.penguji1_nama ?? "",
          },
        })
      : await generateSuratUndanganSidangFTI(dataSuratUndanganSidangFTI);
    const fileBase64 = Buffer.from(suratBuffer).toString("base64");
    const mimeSuratUndanganPdf = "application/pdf";

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_UNDANGAN_SIDANG'`,
      [sidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_UNDANGAN_SIDANG', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        sidang.id,
        `Surat_Undangan_Sidang_${npm}.pdf`,
        mimeSuratUndanganPdf,
        fileBase64,
      ],
    );

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'COMPLETED', verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
       WHERE pengajuan_sidang_id = ?`,
      [sidang.id],
    );

    // Auto-create sidang record for this specific pengajuan_sidang (existence guard per pengajuan_sidang_id)
    const [[existingSidang]] = await conn.query(
      `SELECT id FROM sidang WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!existingSidang) {
      const [sidangIns] = await conn.query(
        `INSERT INTO sidang
           (skripsi_id, jenis, nomor_surat, pengajuan_sidang_id)
         VALUES (?, ?, ?, ?)`,
        [skripsiId, sidang.jenis, nomorSuratSidang, sidang.id],
      );
      const newSidangId = sidangIns.insertId;

      // Resolve user_id for each participant (nullable — no account → NULL)
      const resolveUserId = async (nidn) => {
        if (!nidn) return null;
        const [[u]] = await conn.query(
          `SELECT id FROM users WHERE COALESCE(nidn, staff_usr_id) = ? AND is_active = 1 LIMIT 1`,
          [nidn],
        );
        return u?.id ?? null;
      };
      const [p1UserId, p2UserId, pg1UserId, pg2UserId] = await Promise.all([
        resolveUserId(dataRow?.pembimbing1_nidn),
        resolveUserId(dataRow?.pembimbing2_nidn),
        resolveUserId(dataRow?.penguji1_nidn),
        resolveUserId(dataRow?.penguji2_nidn),
      ]);

      // A Seminar Bisnis Digital sidang has one penguji: 3 penilaian and 1 notulen instead of 4 and 2.
      const hasPenguji2 = sidang.jenis !== JENIS.SEMINAR_BISNIS_DIGITAL;
      const pengujiRows = [
        ["PENGUJI_1", pg1UserId],
        ...(hasPenguji2 ? [["PENGUJI_2", pg2UserId]] : []),
      ];
      const penilaianRows = [
        ["PEMBIMBING_1", p1UserId],
        ["PEMBIMBING_2", p2UserId],
        ...pengujiRows,
      ];

      await conn.query(
        `INSERT INTO sidang_penilaian (sidang_id, role, user_id) VALUES ?`,
        [penilaianRows.map(([role, userId]) => [newSidangId, role, userId])],
      );

      await conn.query(
        `INSERT INTO sidang_notulen (sidang_id, role, user_id) VALUES ?`,
        [pengujiRows.map(([role, userId]) => [newSidangId, role, userId])],
      );

      await conn.query(
        `INSERT INTO sidang_hasil_penilaian (sidang_id) VALUES (?)`,
        [newSidangId],
      );
    }

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_COMPLETED",
        "Surat undangan sidang telah dikirim. Pengajuan sidang selesai.",
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    // Best-effort email after commit — failures are logged but never fail the response, since the
    // surat is already stored. It is awaited because on Vercel a send left running after the
    // response can be frozen mid-way and silently dropped; the timeout caps how long a slow SMTP
    // server can hold the request.
    const recipients = [
      pembimbing1Email,
      pembimbing2Email,
      penguji1Email,
      penguji2Email,
      dataRow?.mahasiswa_email ?? null,
    ].filter(Boolean);

    if (recipients.length > 0) {
      let emailTimer;
      try {
        await Promise.race([
          sendSuratUndangan({
            recipients,
            suratBuffer,
            npm,
            namaMahasiswa: dataRow?.nama_mahasiswa ?? "",
            sidangDate,
            sidangTime,
            tempat: dataRow?.tempat_sidang ?? "",
            judulSkripsi: dataRow?.judul_skripsi ?? "",
            namaKegiatan: isSeminar ? "Seminar Proposal" : "Sidang Skripsi",
          }),
          new Promise((_, reject) => {
            emailTimer = setTimeout(
              () => reject(new Error("timeout after 10s")),
              10000,
            );
          }),
        ]);
      } catch (err) {
        console.error(
          "[generateSuratUndangan] email dispatch failed:",
          err?.message ?? err,
        );
      } finally {
        clearTimeout(emailTimer);
      }
    }

    return res.json({ ok: true, data: { status: "COMPLETED" } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};
