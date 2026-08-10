const db = require("../db");
const ExcelJS = require("exceljs");

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn],
  );
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return NaN;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDurationHours(startValue, endValue) {
  if (!startValue || !endValue) return "";
  const start = toDateOnly(startValue);
  const end = toDateOnly(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return `${days} hari`;
}

function addRowWithDashes(sheet, data) {
  const withDashes = {};
  for (const [key, value] of Object.entries(data)) {
    withDashes[key] = value === null || value === undefined || value === "" ? "-" : value;
  }
  return sheet.addRow(withDashes);
}

async function sendWorkbook(res, workbook, fileName) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function resolveKaprodiProgramStudi(req, res) {
  if (!req.user.hasRole("LECTURER", "KAPRODI")) {
    res.status(403).json({ ok: false, message: "Only Kaprodi can access this endpoint" });
    return null;
  }

  const nidn = await getLecturerNidn(req.user.id);
  if (!nidn) {
    res.status(400).json({ ok: false, message: "Data dosen tidak valid" });
    return null;
  }

  const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
  if (programStudiIds.length === 0) {
    res.status(403).json({ ok: false, message: "You are not assigned as Kaprodi" });
    return null;
  }

  return programStudiIds;
}

function formatPeriodLabel(req) {
  const tahunAkademik = req.query.tahunAkademik ? String(req.query.tahunAkademik) : null;
  const periodeAkademik = req.query.periodeAkademik ? String(req.query.periodeAkademik) : null;
  if (!tahunAkademik || !periodeAkademik) return "Semua Periode";
  const periodeLabel = periodeAkademik.charAt(0) + periodeAkademik.slice(1).toLowerCase();
  return `${tahunAkademik.replace("/", "-")} ${periodeLabel}`;
}

function buildPeriodFilter(req, tableAlias) {
  const tahunAkademik = req.query.tahunAkademik ? String(req.query.tahunAkademik) : null;
  const periodeAkademik = req.query.periodeAkademik ? String(req.query.periodeAkademik) : null;

  const clauses = [];
  const params = [];

  if (tahunAkademik) {
    clauses.push(`${tableAlias}.tahun_akademik = ?`);
    params.push(tahunAkademik);
  }
  if (periodeAkademik) {
    clauses.push(`${tableAlias}.periode_akademik = ?`);
    params.push(periodeAkademik);
  }

  return { clauses, params };
}

async function getProgramStudiLabel(programStudiIds) {
  const placeholders = programStudiIds.map(() => "?").join(",");
  const [rows] = await db.query(
    `SELECT nama FROM program_studi WHERE id IN (${placeholders})`,
    programStudiIds,
  );
  return rows.map((r) => r.nama).join(" & ");
}

async function getDosenNamesByNidn(nidns) {
  const uniqueNidns = [...new Set(nidns.filter(Boolean))];
  if (uniqueNidns.length === 0) return new Map();
  const [rows] = await db.query(
    `SELECT nidn, nama FROM dosen WHERE nidn IN (?)`,
    [uniqueNidns],
  );
  const map = new Map();
  for (const row of rows) map.set(row.nidn, row.nama);
  return map;
}

function resolveActiveKonsultasiOutlineStage(stages, isCompleted) {
  const p2 = stages.find((s) => s.stage === "PEMBIMBING_2") ?? null;
  const p1 = stages.find((s) => s.stage === "PEMBIMBING_1") ?? null;

  if (isCompleted || p1?.current_status === "ACCEPTED") {
    return {
      activeStage: p1?.stage ?? "PEMBIMBING_1",
      activeStatus: p1?.current_status ?? "ACCEPTED",
      isCompleted: true,
      stageRow: p1,
    };
  }
  if (!p2) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }
  if (p2.current_status !== "CONTINUE") {
    return {
      activeStage: "PEMBIMBING_2",
      activeStatus: p2.current_status,
      isCompleted: false,
      stageRow: p2,
    };
  }
  if (!p1) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }
  return {
    activeStage: "PEMBIMBING_1",
    activeStatus: p1.current_status,
    isCompleted: false,
    stageRow: p1,
  };
}

const STAGE_LABELS = {
  PEMBIMBING_2: "Pembimbing 2",
  PEMBIMBING_1: "Pembimbing 1",
  PENGUJI_2: "Penguji 2",
  PENGUJI_1: "Penguji 1",
};

const OUTLINE_STATUS_LABELS = {
  SUBMITTED: "Menunggu Balasan Kaprodi",
  NEED_REVISION: "Menunggu Revisi Mahasiswa",
  REJECTED: "Ditolak Kaprodi",
  ACCEPTED: "Diterima Kaprodi",
};

const OUTLINE_WAITING_ON = {
  SUBMITTED: "Kaprodi",
  NEED_REVISION: "Mahasiswa",
};

const DISPOSISI_STATUS_LABELS = {
  SUBMITTED: "Menunggu Balasan Kaprodi",
  NEED_REVISION: "Menunggu Revisi Mahasiswa",
  APPROVED: "Diterima Kaprodi",
  REJECTED: "Ditolak Kaprodi",
};

const DISPOSISI_WAITING_ON = {
  SUBMITTED: "Kaprodi",
  NEED_REVISION: "Mahasiswa",
};

function resolveWaitingOn(activeStatus) {
  if (activeStatus === "WAITING_SUBMISSION" || activeStatus === "NEED_REVISION") {
    return "Mahasiswa";
  }
  if (activeStatus === "SUBMITTED" || activeStatus === "IN_REVIEW") {
    return "Dosen Pembimbing";
  }
  return "";
}

const CHAPTER_ORDER = ["BAB_1", "BAB_2", "BAB_3", "BAB_4", "BAB_5"];

const CHAPTER_LABELS = {
  BAB_1: "Bab 1",
  BAB_2: "Bab 2",
  BAB_3: "Bab 3",
  BAB_4: "Bab 4",
  BAB_5: "Bab 5",
};

function resolveActiveKonsultasiSkripsiStage(stages) {
  for (const chapterGroup of CHAPTER_ORDER) {
    const p2 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_2") ?? null;
    const p1 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_1") ?? null;

    if (!p2) {
      return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
    }
    if (p2.current_status !== "CONTINUE") {
      return { chapterGroup, activeStage: "PEMBIMBING_2", activeStatus: p2.current_status, stageRow: p2 };
    }
    if (!p1) {
      return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
    }
    if (p1.current_status !== "ACCEPTED") {
      return { chapterGroup, activeStage: "PEMBIMBING_1", activeStatus: p1.current_status, stageRow: p1 };
    }
  }
  return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
}

exports.exportOutlineReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Pengajuan Outline - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");
    const where = [`m.program_studi_id IN (${placeholders})`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         o.id,
         o.judul,
         o.status,
         o.npm,
         o.created_at,
         o.pembimbing1_nidn,
         o.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik,
         latest_sub.id AS latest_submission_id,
         review.reviewed_at AS decision_at
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       LEFT JOIN (
         SELECT outline_id, MAX(submission_no) AS max_submission_no
         FROM outline_submissions
         GROUP BY outline_id
       ) latest_no ON latest_no.outline_id = o.id
       LEFT JOIN outline_submissions latest_sub
         ON latest_sub.outline_id = o.id AND latest_sub.submission_no = latest_no.max_submission_no
       LEFT JOIN outline_reviews review ON review.submission_id = latest_sub.id
       WHERE ${where.join(" AND ")}
       ORDER BY o.created_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Outline");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Status", key: "status", width: 16 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Tanggal Diajukan", key: "tanggal_submit", width: 20 },
      { header: "Tanggal Keputusan", key: "tanggal_keputusan", width: 20 },
      { header: "Durasi", key: "durasi", width: 18 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        status: OUTLINE_STATUS_LABELS[row.status] ?? row.status,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        tanggal_submit: formatDateTime(row.created_at),
        tanggal_keputusan: formatDateTime(row.decision_at),
        durasi: formatDurationHours(row.created_at, row.decision_at),
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

exports.exportDisposisiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Disposisi Pembimbing - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");
    const where = [`m.program_studi_id IN (${placeholders})`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         pj.id,
         pj.status,
         pj.submitted_at,
         pj.disposisi_at,
         pj.catatan_kaprodi,
         pj.npm,
         pj.pembimbing1_diajukan_nidn,
         pj.pembimbing2_diajukan_nidn,
         pj.pembimbing1_ditetapkan_nidn,
         pj.pembimbing2_ditetapkan_nidn,
         m.nama AS nama_mahasiswa,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY pj.submitted_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [
        r.pembimbing1_diajukan_nidn,
        r.pembimbing2_diajukan_nidn,
        r.pembimbing1_ditetapkan_nidn,
        r.pembimbing2_ditetapkan_nidn,
      ]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Disposisi Pembimbing");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Status", key: "status", width: 16 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Tanggal Submit", key: "tanggal_submit", width: 20 },
      { header: "Tanggal Keputusan", key: "tanggal_keputusan", width: 20 },
      { header: "Durasi", key: "durasi", width: 18 },
      { header: "Pembimbing 1 Diajukan", key: "pembimbing1_diajukan", width: 24 },
      { header: "Pembimbing 2 Diajukan", key: "pembimbing2_diajukan", width: 24 },
      { header: "Pembimbing 1 Ditetapkan", key: "pembimbing1_ditetapkan", width: 24 },
      { header: "Pembimbing 2 Ditetapkan", key: "pembimbing2_ditetapkan", width: 24 },
      { header: "Catatan Kaprodi", key: "catatan_kaprodi", width: 32 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        status: DISPOSISI_STATUS_LABELS[row.status] ?? row.status,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        tanggal_submit: formatDateTime(row.submitted_at),
        tanggal_keputusan: formatDateTime(row.disposisi_at),
        durasi: formatDurationHours(row.submitted_at, row.disposisi_at),
        pembimbing1_diajukan: dosenNames.get(row.pembimbing1_diajukan_nidn) ?? "",
        pembimbing2_diajukan: dosenNames.get(row.pembimbing2_diajukan_nidn) ?? "",
        pembimbing1_ditetapkan: dosenNames.get(row.pembimbing1_ditetapkan_nidn) ?? "",
        pembimbing2_ditetapkan: dosenNames.get(row.pembimbing2_ditetapkan_nidn) ?? "",
        catatan_kaprodi: row.catatan_kaprodi ?? "",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

exports.exportKonsultasiOutlineReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Konsultasi Outline - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");
    const where = [`o.program_studi_id IN (${placeholders})`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.is_completed,
         k.completed_at,
         o.npm,
         o.judul,
         o.pembimbing1_nidn,
         o.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM kartu_konsultasi_outline k
       INNER JOIN outline o ON o.id = k.outline_id
       INNER JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY o.created_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const kartuIds = rows.map((r) => r.kartu_id);
    const stagesByKartu = new Map();
    if (kartuIds.length > 0) {
      const [stageRows] = await db.query(
        `SELECT id, kartu_konsultasi_outline_id, stage, current_status, started_at, updated_at, finished_at
         FROM konsultasi_outline_stage
         WHERE kartu_konsultasi_outline_id IN (?)`,
        [kartuIds],
      );
      for (const stageRow of stageRows) {
        const list = stagesByKartu.get(stageRow.kartu_konsultasi_outline_id) ?? [];
        list.push(stageRow);
        stagesByKartu.set(stageRow.kartu_konsultasi_outline_id, list);
      }
    }

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Konsultasi Outline");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Tahap Aktif", key: "tahap_aktif", width: 16 },
      { header: "Status", key: "status", width: 18 },
      { header: "Menunggu", key: "menunggu", width: 18 },
      { header: "Terakhir Diperbarui", key: "terakhir_diperbarui", width: 20 },
      { header: "Durasi Sejak Aksi Terakhir", key: "durasi", width: 22 },
      { header: "Tanggal Selesai", key: "tanggal_selesai", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    const now = new Date();

    for (const row of rows) {
      const stages = stagesByKartu.get(row.kartu_id) ?? [];
      const { activeStage, activeStatus, isCompleted, stageRow } =
        resolveActiveKonsultasiOutlineStage(stages, row.is_completed === 1);

      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        tahap_aktif: isCompleted ? "Selesai" : (STAGE_LABELS[activeStage] ?? ""),
        status: isCompleted ? "Selesai" : (activeStatus ?? ""),
        menunggu: isCompleted ? "" : resolveWaitingOn(activeStatus),
        terakhir_diperbarui: stageRow ? formatDateTime(stageRow.updated_at) : "",
        durasi: isCompleted || !stageRow ? "-" : formatDurationHours(stageRow.updated_at, now),
        tanggal_selesai: formatDateTime(row.completed_at),
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

exports.exportKonsultasiSkripsiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Konsultasi Skripsi - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");
    const where = [`sk.program_studi_id IN (${placeholders})`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.is_completed,
         k.completed_at,
         sk.npm,
         sk.judul,
         sk.pembimbing1_nidn,
         sk.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM skripsi sk
       INNER JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN kartu_konsultasi_skripsi k ON k.skripsi_id = sk.id
       LEFT JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY sk.created_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const kartuIds = rows.map((r) => r.kartu_id);
    const stagesByKartu = new Map();
    if (kartuIds.length > 0) {
      const [stageRows] = await db.query(
        `SELECT id, kartu_konsultasi_skripsi_id, chapter_group, stage, current_status, started_at, updated_at, finished_at
         FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id IN (?)`,
        [kartuIds],
      );
      for (const stageRow of stageRows) {
        const list = stagesByKartu.get(stageRow.kartu_konsultasi_skripsi_id) ?? [];
        list.push(stageRow);
        stagesByKartu.set(stageRow.kartu_konsultasi_skripsi_id, list);
      }
    }

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Konsultasi Skripsi");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Bab Aktif", key: "bab_aktif", width: 14 },
      { header: "Tahap Aktif", key: "tahap_aktif", width: 16 },
      { header: "Status", key: "status", width: 18 },
      { header: "Menunggu", key: "menunggu", width: 18 },
      { header: "Terakhir Diperbarui", key: "terakhir_diperbarui", width: 20 },
      { header: "Durasi Sejak Aksi Terakhir", key: "durasi", width: 22 },
      { header: "Tanggal Selesai", key: "tanggal_selesai", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    const now = new Date();

    for (const row of rows) {
      const belumMulai = row.kartu_id === null;
      const stages = belumMulai ? [] : (stagesByKartu.get(row.kartu_id) ?? []);
      const isCompleted = row.is_completed === 1;
      const { chapterGroup, activeStage, activeStatus, stageRow } = belumMulai || isCompleted
        ? { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null }
        : resolveActiveKonsultasiSkripsiStage(stages);
      const isTransisi = !belumMulai && !isCompleted && !stageRow;

      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        bab_aktif: belumMulai ? "-" : (isCompleted ? "Selesai" : (isTransisi ? "Transisi" : (CHAPTER_LABELS[chapterGroup] ?? ""))),
        tahap_aktif: belumMulai ? "-" : (isCompleted ? "Selesai" : (isTransisi ? "" : (STAGE_LABELS[activeStage] ?? ""))),
        status: belumMulai ? "Belum Memulai" : (isCompleted ? "Selesai" : (isTransisi ? "" : (activeStatus ?? ""))),
        menunggu: belumMulai || isCompleted || isTransisi ? "" : resolveWaitingOn(activeStatus),
        terakhir_diperbarui: stageRow ? formatDateTime(stageRow.updated_at) : "",
        durasi: belumMulai || isCompleted || !stageRow ? "-" : formatDurationHours(stageRow.updated_at, now),
        tanggal_selesai: formatDateTime(row.completed_at),
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

function latestByKey(rows, keyField, tieBreakField = "id") {
  const map = new Map();
  for (const row of rows) {
    const key = row[keyField];
    const existing = map.get(key);
    if (!existing || Number(row[tieBreakField]) > Number(existing[tieBreakField])) {
      map.set(key, row);
    }
  }
  return map;
}

function groupBy(rows, keyField) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[keyField]) ?? [];
    list.push(row);
    map.set(row[keyField], list);
  }
  return map;
}

exports.exportOverallProgressReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Proses Skripsi Mahasiswa - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");

    const [mahasiswaRows] = await db.query(
      `SELECT npm, nama FROM mahasiswa WHERE program_studi_id IN (${placeholders})`,
      programStudiIds,
    );

    const [outlineRows] = await db.query(
      `SELECT o.id, o.npm, o.judul, o.status, o.pembimbing1_nidn, o.pembimbing2_nidn, o.created_at, o.updated_at
       FROM outline o
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE o.program_studi_id IN (${placeholders}) ${periodClauses.map((c) => `AND ${c}`).join(" ")}
       ORDER BY o.npm, o.id DESC`,
      [...programStudiIds, ...periodParams],
    );
    const latestOutlineByNpm = latestByKey(outlineRows, "npm");

    // Anchor on every student in the prodi, not just those with an outline —
    // students who never submitted one still need to appear in the report
    // as "Belum Memulai", even when a period filter is active.
    const students = mahasiswaRows.map((m) => ({
      npm: m.npm,
      nama_mahasiswa: m.nama,
      outline: latestOutlineByNpm.get(m.npm) ?? null,
    }));

    if (students.length === 0) {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("Laporan Keseluruhan");
      await sendWorkbook(res, workbook, fileName);
      return;
    }

    const latestOutlines = students.map((s) => s.outline).filter(Boolean);
    const outlineIds = latestOutlines.map((o) => o.id);
    const npmsWithOutline = latestOutlines.map((o) => o.npm);

    const disposisiByOutlineId = new Map();
    const kartuOutlineByOutlineId = new Map();
    const outlineStagesByKartu = new Map();
    const skByOutlineId = new Map();
    const latestSkripsiByNpm = new Map();

    if (outlineIds.length > 0) {
      const [disposisiRows] = await db.query(
        `SELECT id, outline_id, status, updated_at FROM pengajuan_disposisi_pembimbing WHERE outline_id IN (?)`,
        [outlineIds],
      );
      for (const r of disposisiRows) disposisiByOutlineId.set(r.outline_id, r);

      const [kartuOutlineRows] = await db.query(
        `SELECT id, outline_id, is_completed, completed_at FROM kartu_konsultasi_outline WHERE outline_id IN (?)`,
        [outlineIds],
      );
      for (const r of kartuOutlineRows) kartuOutlineByOutlineId.set(r.outline_id, r);
      const kartuOutlineIds = kartuOutlineRows.map((r) => r.id);

      if (kartuOutlineIds.length > 0) {
        const [stageRows] = await db.query(
          `SELECT id, kartu_konsultasi_outline_id, stage, current_status, started_at, updated_at, finished_at
           FROM konsultasi_outline_stage
           WHERE kartu_konsultasi_outline_id IN (?)`,
          [kartuOutlineIds],
        );
        for (const s of stageRows) {
          const list = outlineStagesByKartu.get(s.kartu_konsultasi_outline_id) ?? [];
          list.push(s);
          outlineStagesByKartu.set(s.kartu_konsultasi_outline_id, list);
        }
      }

      const [skRows] = await db.query(
        `SELECT id, outline_id, status FROM pengajuan_sk_penelitian WHERE outline_id IN (?)`,
        [outlineIds],
      );
      for (const r of skRows) skByOutlineId.set(r.outline_id, r);

      const [skripsiRows] = await db.query(
        `SELECT id, npm, outline_id, judul, status, pembimbing1_nidn, pembimbing2_nidn
         FROM skripsi
         WHERE npm IN (?)
         ORDER BY npm, id DESC`,
        [npmsWithOutline],
      );
      for (const [npm, row] of latestByKey(skripsiRows, "npm")) {
        latestSkripsiByNpm.set(npm, row);
      }
    }

    const skripsiIds = [...latestSkripsiByNpm.values()].map((s) => s.id);

    const kartuSkripsiByskripsiId = new Map();
    const skripsiStagesByKartu = new Map();
    const pengajuanSidangByskripsiId = new Map();
    const pengajuanSidangKaprodiByPengajuanSidangId = new Map();
    const sidangByskripsiId = new Map();
    const revisiBySidangId = new Map();
    const revisiStagesByRevisiId = new Map();
    const pengumpulanByskripsiId = new Map();

    if (skripsiIds.length > 0) {
      const [kartuSkripsiRows] = await db.query(
        `SELECT id, skripsi_id, is_completed, completed_at FROM kartu_konsultasi_skripsi WHERE skripsi_id IN (?)`,
        [skripsiIds],
      );
      for (const r of kartuSkripsiRows) kartuSkripsiByskripsiId.set(r.skripsi_id, r);
      const kartuSkripsiIds = kartuSkripsiRows.map((r) => r.id);

      if (kartuSkripsiIds.length > 0) {
        const [stageRows] = await db.query(
          `SELECT id, kartu_konsultasi_skripsi_id, chapter_group, stage, current_status, started_at, updated_at, finished_at
           FROM konsultasi_skripsi_stage
           WHERE kartu_konsultasi_skripsi_id IN (?)`,
          [kartuSkripsiIds],
        );
        for (const s of stageRows) {
          const list = skripsiStagesByKartu.get(s.kartu_konsultasi_skripsi_id) ?? [];
          list.push(s);
          skripsiStagesByKartu.set(s.kartu_konsultasi_skripsi_id, list);
        }
      }

      const [pengajuanSidangRows] = await db.query(
        `SELECT id, skripsi_id, status, ujian_ke FROM pengajuan_sidang WHERE skripsi_id IN (?) ORDER BY skripsi_id, id DESC`,
        [skripsiIds],
      );
      const latestPengajuanSidangBySkripsiId = latestByKey(pengajuanSidangRows, "skripsi_id");
      for (const [skripsiId, row] of latestPengajuanSidangBySkripsiId) {
        pengajuanSidangByskripsiId.set(skripsiId, row);
      }
      const pengajuanSidangIds = [...latestPengajuanSidangBySkripsiId.values()].map((r) => r.id);

      if (pengajuanSidangIds.length > 0) {
        const [pskRows] = await db.query(
          `SELECT id, pengajuan_sidang_id, status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id IN (?)`,
          [pengajuanSidangIds],
        );
        for (const r of pskRows) pengajuanSidangKaprodiByPengajuanSidangId.set(r.pengajuan_sidang_id, r);
      }

      const [sidangRows] = await db.query(
        `SELECT id, skripsi_id, status, hasil_sidang FROM sidang WHERE skripsi_id IN (?) ORDER BY skripsi_id, id DESC`,
        [skripsiIds],
      );
      const latestSidangBySkripsiId = latestByKey(sidangRows, "skripsi_id");
      for (const [skripsiId, row] of latestSidangBySkripsiId) {
        sidangByskripsiId.set(skripsiId, row);
      }
      const sidangIds = [...latestSidangBySkripsiId.values()].map((r) => r.id);

      if (sidangIds.length > 0) {
        const [revisiRows] = await db.query(
          `SELECT id, sidang_id, is_completed FROM revisi_pasca_sidang WHERE sidang_id IN (?)`,
          [sidangIds],
        );
        for (const r of revisiRows) revisiBySidangId.set(r.sidang_id, r);

        const revisiIds = revisiRows.map((r) => r.id);
        if (revisiIds.length > 0) {
          const [revisiStageRows] = await db.query(
            `SELECT id, revisi_id, signer_role, current_status, updated_at
             FROM revisi_pasca_sidang_stages
             WHERE revisi_id IN (?)`,
            [revisiIds],
          );
          for (const s of revisiStageRows) {
            const list = revisiStagesByRevisiId.get(s.revisi_id) ?? [];
            list.push(s);
            revisiStagesByRevisiId.set(s.revisi_id, list);
          }
        }
      }

      const [pengumpulanRows] = await db.query(
        `SELECT id, skripsi_id, status FROM pengumpulan_berkas_final WHERE skripsi_id IN (?)`,
        [skripsiIds],
      );
      for (const r of pengumpulanRows) pengumpulanByskripsiId.set(r.skripsi_id, r);
    }

    const dosenNames = await getDosenNamesByNidn(
      latestOutlines.flatMap((o) => [o.pembimbing1_nidn, o.pembimbing2_nidn]).concat(
        [...latestSkripsiByNpm.values()].flatMap((s) => [s.pembimbing1_nidn, s.pembimbing2_nidn]),
      ),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Keseluruhan");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Fase", key: "fase", width: 26 },
      { header: "Detail Tahap", key: "detail_tahap", width: 26 },
      { header: "Status", key: "status", width: 18 },
      { header: "Menunggu", key: "menunggu", width: 18, hidden: true },
      { header: "Durasi Sejak Aksi Terakhir", key: "durasi", width: 22 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };

    const now = new Date();

    for (const student of students) {
      const outline = student.outline;

      let fase = "";
      let detailTahap = "";
      let status = "";
      let menunggu = "";
      let durasi = "-";
      let judul = outline?.judul ?? "";
      let pembimbing1Nidn = outline?.pembimbing1_nidn ?? null;
      let pembimbing2Nidn = outline?.pembimbing2_nidn ?? null;

      const setKonsultasiFields = (label, chapterLabel, activeStage, activeStatus, stageRow, isCompleted) => {
        fase = label;
        detailTahap = chapterLabel
          ? `${chapterLabel} - ${STAGE_LABELS[activeStage] ?? ""}`
          : (STAGE_LABELS[activeStage] ?? "");
        status = activeStatus ?? "";
        menunggu = resolveWaitingOn(activeStatus);
        durasi = stageRow ? formatDurationHours(stageRow.updated_at, now) : "-";
        if (isCompleted) {
          detailTahap = "";
          status = "";
          menunggu = "";
          durasi = "-";
        }
      };

      if (!outline) {
        fase = "Belum Memulai";
        status = "";
      } else {
        const skripsi = latestSkripsiByNpm.get(outline.npm) ?? null;
        const belongsToThisOutline = skripsi && skripsi.outline_id === outline.id;

        if (!belongsToThisOutline) {
          // No skripsi tied to this outline yet — resolve within the pre-skripsi phases.
          const disposisi = disposisiByOutlineId.get(outline.id) ?? null;
          const kartuOutline = kartuOutlineByOutlineId.get(outline.id) ?? null;
          const skPenelitian = skByOutlineId.get(outline.id) ?? null;

          if (skPenelitian) {
            fase = "Pengajuan SK Penelitian";
            status = skPenelitian.status;
          } else if (kartuOutline) {
            const stages = outlineStagesByKartu.get(kartuOutline.id) ?? [];
            const isCompleted = kartuOutline.is_completed === 1;
            const { activeStage, activeStatus, stageRow } = resolveActiveKonsultasiOutlineStage(stages, isCompleted);
            setKonsultasiFields("Konsultasi Outline", null, activeStage, activeStatus, stageRow, isCompleted);
            if (isCompleted) status = "Menunggu Pengajuan SK Penelitian";
          } else if (disposisi) {
            fase = "Pengajuan Disposisi Pembimbing";
            status = DISPOSISI_STATUS_LABELS[disposisi.status] ?? disposisi.status;
            detailTahap = "-";
            menunggu = DISPOSISI_WAITING_ON[disposisi.status] ?? "";
            durasi = formatDurationHours(disposisi.updated_at, now);
          } else {
            fase = "Pengajuan Outline";
            status = OUTLINE_STATUS_LABELS[outline.status] ?? outline.status;
            detailTahap = "-";
            menunggu = OUTLINE_WAITING_ON[outline.status] ?? "";
            durasi = formatDurationHours(outline.updated_at, now);
          }
        } else {
          // A skripsi exists for this outline — resolve from the most advanced phase downward.
          judul = skripsi.judul ?? judul;
          pembimbing1Nidn = skripsi.pembimbing1_nidn ?? pembimbing1Nidn;
          pembimbing2Nidn = skripsi.pembimbing2_nidn ?? pembimbing2Nidn;

          const pengumpulan = pengumpulanByskripsiId.get(skripsi.id) ?? null;
          const sidang = sidangByskripsiId.get(skripsi.id) ?? null;
          const revisi = sidang ? (revisiBySidangId.get(sidang.id) ?? null) : null;
          const pengajuanSidang = pengajuanSidangByskripsiId.get(skripsi.id) ?? null;
          const pengajuanSidangKaprodi = pengajuanSidang
            ? (pengajuanSidangKaprodiByPengajuanSidangId.get(pengajuanSidang.id) ?? null)
            : null;
          const kartuSkripsi = kartuSkripsiByskripsiId.get(skripsi.id) ?? null;

          if (skripsi.status === "GAGAL") {
            fase = "Sidang";
            detailTahap = "Gagal (Plagiat)";
            status = "GAGAL";
          } else if (pengumpulan) {
            fase = pengumpulan.status === "COMPLETED" ? "Selesai" : "Pengumpulan Berkas Final";
            status = pengumpulan.status;
          } else if (revisi) {
            const stages = revisiStagesByRevisiId.get(revisi.id) ?? [];
            const isCompleted = revisi.is_completed === 1;
            const { activeStage, activeStatus, stageRow } = resolveActiveRevisiStage(stages, isCompleted);
            const isTransisi = !isCompleted && !stageRow;
            fase = isCompleted ? "Selesai" : "Revisi Pasca Sidang";
            detailTahap = isCompleted ? "" : (isTransisi ? "Transisi" : (STAGE_LABELS[activeStage] ?? ""));
            status = isCompleted || isTransisi ? "" : (activeStatus ?? "");
            menunggu = isCompleted || isTransisi ? "" : resolveWaitingOn(activeStatus);
            durasi = stageRow ? formatDurationHours(stageRow.updated_at, now) : "-";
          } else if (sidang) {
            fase = "Sidang";
            status = sidang.hasil_sidang ?? sidang.status;
          } else if (pengajuanSidang) {
            fase = "Pengajuan Sidang";
            status = pengajuanSidang.status;
            if (pengajuanSidang.ujian_ke > 1) detailTahap = `Ujian Ke-${pengajuanSidang.ujian_ke}`;
          } else if (pengajuanSidangKaprodi) {
            fase = "Pengajuan Sidang Kaprodi";
            status = pengajuanSidangKaprodi.status;
          } else if (kartuSkripsi) {
            const stages = skripsiStagesByKartu.get(kartuSkripsi.id) ?? [];
            const isCompleted = kartuSkripsi.is_completed === 1;
            const { chapterGroup, activeStage, activeStatus, stageRow } = isCompleted
              ? { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null }
              : resolveActiveKonsultasiSkripsiStage(stages);
            setKonsultasiFields(
              "Konsultasi Skripsi",
              chapterGroup ? CHAPTER_LABELS[chapterGroup] : null,
              activeStage,
              activeStatus,
              stageRow,
              isCompleted,
            );
            if (isCompleted) status = "Menunggu Pengajuan Sidang Kaprodi";
          } else {
            fase = "Konsultasi Skripsi";
            status = "Belum Memulai";
          }
        }
      }

      addRowWithDashes(sheet, {
        npm: student.npm,
        nama_mahasiswa: student.nama_mahasiswa ?? "",
        judul: judul ?? "",
        fase,
        detail_tahap: detailTahap,
        status,
        menunggu,
        durasi,
        pembimbing1: dosenNames.get(pembimbing1Nidn) ?? "-",
        pembimbing2: dosenNames.get(pembimbing2Nidn) ?? "-",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

exports.exportPengajuanSidangKaprodiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Pengajuan Sidang Kaprodi - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "ssp");
    const where = [`s.program_studi_id IN (${placeholders})`, `psk.status != 'DRAFT'`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         psk.status,
         psk.submitted_at,
         psk.reviewed_at,
         psk.catatan_kaprodi,
         psk.penguji1_nidn,
         psk.penguji2_nidn,
         psk.tanggal_sidang,
         psk.waktu_sidang,
         psk.tempat_sidang,
         psk.ipk,
         s.npm,
         s.judul,
         s.pembimbing1_nidn,
         s.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         ps_sidang.ujian_ke,
         ssp.tahun_akademik AS period_tahun_akademik,
         ssp.periode_akademik AS period_periode_akademik
       FROM (
         SELECT skripsi_id, MAX(id) AS latest_id
         FROM pengajuan_sidang
         GROUP BY skripsi_id
       ) latest
       INNER JOIN pengajuan_sidang ps_sidang ON ps_sidang.id = latest.latest_id
       INNER JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = ps_sidang.id
       INNER JOIN skripsi s ON s.id = ps_sidang.skripsi_id
       INNER JOIN mahasiswa m ON m.npm = s.npm
       LEFT JOIN sidang_submission_period ssp ON ssp.id = ps_sidang.sidang_submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY psk.submitted_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn, r.penguji1_nidn, r.penguji2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Pengajuan Sidang Kaprodi");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Ujian Ke", key: "ujian_ke", width: 10 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Status", key: "status", width: 18 },
      { header: "Tanggal Submit", key: "tanggal_submit", width: 20 },
      { header: "Tanggal Keputusan", key: "tanggal_keputusan", width: 20 },
      { header: "Durasi", key: "durasi", width: 18 },
      { header: "Tanggal Sidang", key: "tanggal_sidang", width: 16 },
      { header: "Waktu Sidang", key: "waktu_sidang", width: 14 },
      { header: "Tempat Sidang", key: "tempat_sidang", width: 24 },
      { header: "Penguji 1", key: "penguji1", width: 24 },
      { header: "Penguji 2", key: "penguji2", width: 24 },
      { header: "IPK", key: "ipk", width: 10 },
      { header: "Catatan Kaprodi", key: "catatan_kaprodi", width: 32 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        ujian_ke: row.ujian_ke,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        status: row.status,
        tanggal_submit: formatDateTime(row.submitted_at),
        tanggal_keputusan: formatDateTime(row.reviewed_at),
        durasi: formatDurationHours(row.submitted_at, row.reviewed_at),
        tanggal_sidang: formatDateTime(row.tanggal_sidang),
        waktu_sidang: row.waktu_sidang ?? "",
        tempat_sidang: row.tempat_sidang ?? "",
        penguji1: dosenNames.get(row.penguji1_nidn) ?? "",
        penguji2: dosenNames.get(row.penguji2_nidn) ?? "",
        ipk: row.ipk ?? "",
        catatan_kaprodi: row.catatan_kaprodi ?? "",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

exports.exportSidangReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const periodLabel = formatPeriodLabel(req);
    const fileName = `Laporan Sidang - ${programStudiLabel} - ${periodLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "ssp");
    const where = [`sk.program_studi_id IN (${placeholders})`, ...periodClauses];

    const [rows] = await db.query(
      `SELECT
         sd.id,
         sd.nomor_surat,
         sd.status,
         sd.hasil_sidang,
         sk.npm,
         sk.judul,
         sk.pembimbing1_nidn,
         sk.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         ps.ujian_ke,
         psk.penguji1_nidn,
         psk.penguji2_nidn,
         psk.tanggal_sidang,
         psk.waktu_sidang,
         psk.tempat_sidang,
         shp.rata,
         shp.grade,
         shp.catatan_penguji,
         ssp.tahun_akademik AS period_tahun_akademik,
         ssp.periode_akademik AS period_periode_akademik
       FROM (
         SELECT skripsi_id, MAX(id) AS latest_sidang_id
         FROM sidang
         GROUP BY skripsi_id
       ) latest
       INNER JOIN sidang sd ON sd.id = latest.latest_sidang_id
       INNER JOIN skripsi sk ON sk.id = sd.skripsi_id
       INNER JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang ps ON ps.id = sd.pengajuan_sidang_id
       LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = sd.pengajuan_sidang_id
       LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = sd.id
       LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY sd.created_at DESC`,
      [...programStudiIds, ...periodParams],
    );

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn, r.penguji1_nidn, r.penguji2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Sidang");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Ujian Ke", key: "ujian_ke", width: 10 },
      { header: "Tahun Akademik", key: "tahun_akademik", width: 16 },
      { header: "Periode Akademik", key: "periode_akademik", width: 16 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Penguji 1", key: "penguji1", width: 24 },
      { header: "Penguji 2", key: "penguji2", width: 24 },
      { header: "Status", key: "status", width: 16 },
      { header: "Tanggal Sidang", key: "tanggal_sidang", width: 16 },
      { header: "Waktu Sidang", key: "waktu_sidang", width: 14 },
      { header: "Tempat Sidang", key: "tempat_sidang", width: 24 },
      { header: "Hasil Sidang", key: "hasil_sidang", width: 16 },
      { header: "Rata-Rata", key: "rata", width: 12 },
      { header: "Grade", key: "grade", width: 10 },
      { header: "Catatan Penguji", key: "catatan_penguji", width: 32 },
      { header: "Nomor Surat", key: "nomor_surat", width: 28 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        ujian_ke: row.ujian_ke,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        penguji1: dosenNames.get(row.penguji1_nidn) ?? "",
        penguji2: dosenNames.get(row.penguji2_nidn) ?? "",
        status: row.status,
        tanggal_sidang: formatDateTime(row.tanggal_sidang),
        waktu_sidang: row.waktu_sidang ?? "",
        tempat_sidang: row.tempat_sidang ?? "",
        hasil_sidang: row.hasil_sidang ?? "",
        rata: row.rata ?? "",
        grade: row.grade ?? "",
        catatan_penguji: row.catatan_penguji ?? "",
        nomor_surat: row.nomor_surat ?? "",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

const RPS_STAGE_ORDER = ["PENGUJI_2", "PENGUJI_1", "PEMBIMBING_2", "PEMBIMBING_1"];

function resolveActiveRevisiStage(stages, isCompleted) {
  if (isCompleted) return { activeStage: null, activeStatus: null, stageRow: null };
  for (const role of RPS_STAGE_ORDER) {
    const stage = stages.find((s) => s.signer_role === role);
    if (!stage) return { activeStage: null, activeStatus: null, stageRow: null };
    if (stage.current_status !== "APPROVED") {
      return { activeStage: role, activeStatus: stage.current_status, stageRow: stage };
    }
  }
  return { activeStage: null, activeStatus: null, stageRow: null };
}

function getNidnForRevisiRole(row, role) {
  if (role === "PENGUJI_2") return row.penguji2_nidn;
  if (role === "PENGUJI_1") return row.penguji1_nidn;
  if (role === "PEMBIMBING_2") return row.pembimbing2_nidn;
  if (role === "PEMBIMBING_1") return row.pembimbing1_nidn;
  return null;
}

exports.exportRevisiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const fileName = `Laporan Revisi Pasca Sidang - ${programStudiLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");

    const [rawRows] = await db.query(
      `SELECT
         rps.id AS revisi_id,
         rps.is_completed,
         sk.id AS skripsi_id,
         sk.npm,
         sk.judul,
         sk.pembimbing1_nidn,
         sk.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         psk.penguji1_nidn,
         psk.penguji2_nidn
       FROM revisi_pasca_sidang rps
       INNER JOIN sidang s ON s.id = rps.sidang_id
       INNER JOIN skripsi sk ON sk.id = s.skripsi_id
       INNER JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE sk.program_studi_id IN (${placeholders})
       ORDER BY sk.id, rps.id DESC`,
      programStudiIds,
    );

    const rows = [...latestByKey(rawRows, "skripsi_id", "revisi_id").values()];

    const revisiIds = rows.map((r) => r.revisi_id);
    const stagesByRevisi = new Map();
    if (revisiIds.length > 0) {
      const [stageRows] = await db.query(
        `SELECT id, revisi_id, signer_role, current_status, updated_at
         FROM revisi_pasca_sidang_stages
         WHERE revisi_id IN (?)`,
        [revisiIds],
      );
      for (const s of stageRows) {
        const list = stagesByRevisi.get(s.revisi_id) ?? [];
        list.push(s);
        stagesByRevisi.set(s.revisi_id, list);
      }
    }

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn, r.penguji1_nidn, r.penguji2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Revisi Pasca Sidang");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Penguji 1", key: "penguji1", width: 24 },
      { header: "Penguji 2", key: "penguji2", width: 24 },
      { header: "Tahap Aktif", key: "tahap_aktif", width: 16 },
      { header: "Signer Aktif", key: "signer_aktif", width: 24 },
      { header: "Status", key: "status", width: 18 },
      { header: "Menunggu", key: "menunggu", width: 18 },
      { header: "Terakhir Diperbarui", key: "terakhir_diperbarui", width: 20 },
      { header: "Durasi Sejak Aksi Terakhir", key: "durasi", width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };

    const now = new Date();

    for (const row of rows) {
      const stages = stagesByRevisi.get(row.revisi_id) ?? [];
      const isCompleted = row.is_completed === 1;
      const { activeStage, activeStatus, stageRow } = resolveActiveRevisiStage(stages, isCompleted);
      const isTransisi = !isCompleted && !stageRow;
      const signerNidn = activeStage ? getNidnForRevisiRole(row, activeStage) : null;

      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        penguji1: dosenNames.get(row.penguji1_nidn) ?? "",
        penguji2: dosenNames.get(row.penguji2_nidn) ?? "",
        tahap_aktif: isCompleted ? "Selesai" : (isTransisi ? "Transisi" : (STAGE_LABELS[activeStage] ?? "")),
        signer_aktif: isCompleted || isTransisi ? "" : (dosenNames.get(signerNidn) ?? ""),
        status: isCompleted ? "Selesai" : (isTransisi ? "" : (activeStatus ?? "")),
        menunggu: isCompleted || isTransisi ? "" : resolveWaitingOn(activeStatus),
        terakhir_diperbarui: stageRow ? formatDateTime(stageRow.updated_at) : "",
        durasi: isCompleted || !stageRow ? "-" : formatDurationHours(stageRow.updated_at, now),
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};

function confirmationCell(confirmedAt) {
  return confirmedAt ? `Sudah (${formatDateTime(confirmedAt)})` : "Belum";
}

exports.exportBerkasFinalReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

    const programStudiLabel = await getProgramStudiLabel(programStudiIds);
    const fileName = `Laporan Pengumpulan Berkas Final - ${programStudiLabel}.xlsx`;

    const placeholders = programStudiIds.map(() => "?").join(",");

    const [rows] = await db.query(
      `SELECT
         pbf.id AS pengumpulan_id,
         pbf.status,
         pbf.is_completed,
         pbf.updated_at,
         sk.npm,
         sk.judul,
         sk.pembimbing1_nidn,
         sk.pembimbing2_nidn,
         m.nama AS nama_mahasiswa,
         psk.penguji1_nidn,
         psk.penguji2_nidn
       FROM pengumpulan_berkas_final pbf
       INNER JOIN skripsi sk ON sk.id = pbf.skripsi_id
       INNER JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN sidang s ON s.skripsi_id = pbf.skripsi_id
              AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id)
       LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE sk.program_studi_id IN (${placeholders})
       ORDER BY sk.npm`,
      programStudiIds,
    );

    const pengumpulanIds = rows.map((r) => r.pengumpulan_id);
    const confirmationsByPengumpulan = new Map();
    if (pengumpulanIds.length > 0) {
      const [confirmationRows] = await db.query(
        `SELECT pengumpulan_id, recipient_role, confirmed_at
         FROM pengumpulan_berkas_final_confirmations
         WHERE pengumpulan_id IN (?)`,
        [pengumpulanIds],
      );
      for (const c of confirmationRows) {
        const map = confirmationsByPengumpulan.get(c.pengumpulan_id) ?? new Map();
        map.set(c.recipient_role, c.confirmed_at);
        confirmationsByPengumpulan.set(c.pengumpulan_id, map);
      }
    }

    const dosenNames = await getDosenNamesByNidn(
      rows.flatMap((r) => [r.pembimbing1_nidn, r.pembimbing2_nidn, r.penguji1_nidn, r.penguji2_nidn]),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Laporan Pengumpulan Berkas Final");

    sheet.columns = [
      { header: "NPM", key: "npm", width: 15 },
      { header: "Nama Mahasiswa", key: "nama_mahasiswa", width: 28 },
      { header: "Judul", key: "judul", width: 40 },
      { header: "Pembimbing 1", key: "pembimbing1", width: 24 },
      { header: "Pembimbing 2", key: "pembimbing2", width: 24 },
      { header: "Penguji 1", key: "penguji1", width: 24 },
      { header: "Penguji 2", key: "penguji2", width: 24 },
      { header: "Status", key: "status", width: 16 },
      { header: "Perpustakaan", key: "perpustakaan", width: 24 },
      { header: "LPPM", key: "lppm", width: 24 },
      { header: "Pembimbing 1 Konfirmasi", key: "pembimbing1_konfirmasi", width: 26 },
      { header: "Pembimbing 2 Konfirmasi", key: "pembimbing2_konfirmasi", width: 26 },
      { header: "Penguji 1 Konfirmasi", key: "penguji1_konfirmasi", width: 26 },
      { header: "Penguji 2 Konfirmasi", key: "penguji2_konfirmasi", width: 26 },
      { header: "Sekprodi (Tanggal Selesai)", key: "sekprodi", width: 28 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      const confirmations = confirmationsByPengumpulan.get(row.pengumpulan_id) ?? new Map();
      const isCompleted = row.status === "COMPLETED";

      addRowWithDashes(sheet, {
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
        penguji1: dosenNames.get(row.penguji1_nidn) ?? "",
        penguji2: dosenNames.get(row.penguji2_nidn) ?? "",
        status: row.status,
        perpustakaan: confirmationCell(confirmations.get("PERPUSTAKAAN")),
        lppm: confirmationCell(confirmations.get("LPPM")),
        pembimbing1_konfirmasi: confirmationCell(confirmations.get("PEMBIMBING_1")),
        pembimbing2_konfirmasi: confirmationCell(confirmations.get("PEMBIMBING_2")),
        penguji1_konfirmasi: confirmationCell(confirmations.get("PENGUJI_1")),
        penguji2_konfirmasi: confirmationCell(confirmations.get("PENGUJI_2")),
        sekprodi: isCompleted ? `Sudah (${formatDateTime(row.updated_at)})` : "Belum",
      });
    }

    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    next(err);
  }
};
