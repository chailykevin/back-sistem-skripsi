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

function formatDurationHours(startValue, endValue) {
  if (!startValue || !endValue) return "";
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const totalHours = (end - start) / (1000 * 60 * 60);
  const days = Math.floor(totalHours / 24);
  const hours = Math.round(totalHours % 24);
  if (days > 0) return `${days} hari ${hours} jam`;
  return `${hours} jam`;
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
      sheet.addRow({
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        judul: row.judul,
        status: row.status,
        tahun_akademik: row.period_tahun_akademik ?? "",
        periode_akademik: row.period_periode_akademik ?? "",
        tanggal_submit: formatDateTime(row.created_at),
        tanggal_keputusan: formatDateTime(row.decision_at),
        durasi: formatDurationHours(row.created_at, row.decision_at),
        pembimbing1: dosenNames.get(row.pembimbing1_nidn) ?? "",
        pembimbing2: dosenNames.get(row.pembimbing2_nidn) ?? "",
      });
    }

    await sendWorkbook(res, workbook, "laporan-outline.xlsx");
  } catch (err) {
    next(err);
  }
};

exports.exportDisposisiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

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
      sheet.addRow({
        npm: row.npm,
        nama_mahasiswa: row.nama_mahasiswa ?? "",
        status: row.status,
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

    await sendWorkbook(res, workbook, "laporan-disposisi-pembimbing.xlsx");
  } catch (err) {
    next(err);
  }
};

exports.exportKonsultasiOutlineReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

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

      sheet.addRow({
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

    await sendWorkbook(res, workbook, "laporan-konsultasi-outline.xlsx");
  } catch (err) {
    next(err);
  }
};

exports.exportKonsultasiSkripsiReport = async (req, res, next) => {
  try {
    const programStudiIds = await resolveKaprodiProgramStudi(req, res);
    if (!programStudiIds) return;

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

      sheet.addRow({
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

    await sendWorkbook(res, workbook, "laporan-konsultasi-skripsi.xlsx");
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

    const placeholders = programStudiIds.map(() => "?").join(",");
    const { clauses: periodClauses, params: periodParams } = buildPeriodFilter(req, "osp");
    const periodFilterActive = periodClauses.length > 0;

    const [mahasiswaRows] = await db.query(
      `SELECT npm, nama FROM mahasiswa WHERE program_studi_id IN (${placeholders})`,
      programStudiIds,
    );

    const [outlineRows] = await db.query(
      `SELECT o.id, o.npm, o.judul, o.status, o.pembimbing1_nidn, o.pembimbing2_nidn, o.created_at
       FROM outline o
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE o.program_studi_id IN (${placeholders}) ${periodClauses.map((c) => `AND ${c}`).join(" ")}
       ORDER BY o.npm, o.id DESC`,
      [...programStudiIds, ...periodParams],
    );
    const latestOutlineByNpm = latestByKey(outlineRows, "npm");

    // Anchor on every student in the prodi, not just those with an outline —
    // students who never submitted one still need to appear in the report
    // (unless a period filter is active, since they don't belong to any period).
    const students = mahasiswaRows
      .map((m) => ({
        npm: m.npm,
        nama_mahasiswa: m.nama,
        outline: latestOutlineByNpm.get(m.npm) ?? null,
      }))
      .filter((s) => !periodFilterActive || s.outline);

    if (students.length === 0) {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("Laporan Keseluruhan");
      await sendWorkbook(res, workbook, "laporan-keseluruhan.xlsx");
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
        `SELECT id, outline_id, status FROM pengajuan_disposisi_pembimbing WHERE outline_id IN (?)`,
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
      { header: "Menunggu", key: "menunggu", width: 18 },
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
        fase = "Belum Mengajukan Outline";
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
            status = disposisi.status;
          } else {
            fase = "Outline";
            status = outline.status;
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
            fase = "Revisi Pasca Sidang";
            status = revisi.is_completed === 1 ? "Selesai" : "Dalam Proses";
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

      sheet.addRow({
        npm: student.npm,
        nama_mahasiswa: student.nama_mahasiswa ?? "",
        judul: judul ?? "",
        fase,
        detail_tahap: detailTahap,
        status,
        menunggu,
        durasi,
        pembimbing1: dosenNames.get(pembimbing1Nidn) ?? "",
        pembimbing2: dosenNames.get(pembimbing2Nidn) ?? "",
      });
    }

    await sendWorkbook(res, workbook, "laporan-keseluruhan.xlsx");
  } catch (err) {
    next(err);
  }
};
