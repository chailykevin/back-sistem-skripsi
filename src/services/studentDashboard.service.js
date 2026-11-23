const db = require("../db");
const { getCurrentOutlineId, getRestartStatus } = require("./outline.service");
const {
  JENIS,
  BISNIS_DIGITAL_PROGRAM_STUDI_KODE,
  resolveJenis,
} = require("./sidangScope.service");
const { getSkSubmissionPeriod } = require("./outlineSubmissionPeriod.service");
const { getOpenPeriod: getOpenSidangPeriod } = require("./sidangSubmissionPeriod.service");
const { skPenulisanName } = require("./skPenulisan.service");
const { isSeminarTahap } = require("./topikSeminar.service");
const {
  CHAPTER_ORDER,
  revisiStageOrderFor,
  resolveActiveKonsultasiOutlineStage,
  resolveActiveKonsultasiSkripsiStage,
  resolveActiveRevisiStage,
} = require("../utils/workflowStage");
const { signatureExistsSql } = require("../utils/signature");
const {
  formatTanggal,
  formatTanggalSingkat,
  formatHariTanggal,
} = require("../utils/dates");
const { getSkripsiRegistrationBlock } = require("../controllers/pengajuanSidang.controller");

const DAY_MS = 24 * 60 * 60 * 1000;
const SEMINAR = JENIS.SEMINAR_BISNIS_DIGITAL;
const SEMINAR_QUERY = "?jenis=SEMINAR_BISNIS_DIGITAL";

// Same statuses as getActivePengajuanSidang in sidangScope.service.js: a pengajuan past VERIFY is "done".
const NON_EDITABLE_PENGAJUAN_STATUSES = [
  "VERIFIED",
  "WAITING_FOR_DISPOSISI",
  "WAITING_FOR_SURAT",
  "COMPLETED",
];

// ---- journey (ported from front-sistem-skripsi studentJourney.ts, which this endpoint replaces) ----

const STEP_DEFS = {
  OUTLINE: {
    key: "OUTLINE",
    title: "Pengajuan Outline",
    shortTitle: "Pengajuan Outline",
    description: "Ajukan dan dapatkan persetujuan proposal skripsi Anda",
    href: "/student/pengajuan-outline",
  },
  KONSULTASI_OUTLINE: {
    key: "KONSULTASI_OUTLINE",
    title: "Konsultasi Outline dengan Dosen Pembimbing",
    shortTitle: "Kons. Outline",
    description: "Pantau dan kelola sesi konsultasi outline Anda bersama dosen pembimbing",
    href: "/student/outline-consultations",
  },
  SK_PENELITIAN: {
    key: "SK_PENELITIAN",
    title: "SK Penulisan Skripsi",
    shortTitle: "SK Penulisan Skripsi",
    description: "Kelola halaman persetujuan dan surat keterangan penelitian",
    href: "/student/sk-penelitian",
  },
  KONSULTASI_SKRIPSI: {
    key: "KONSULTASI_SKRIPSI",
    title: "Konsultasi Skripsi",
    shortTitle: "Kons. Skripsi",
    description: "Kelola konsultasi bab skripsi bersama pembimbing",
    href: "/student/skripsi-consultations",
  },
  KONSULTASI_BAB_1_3: {
    key: "KONSULTASI_BAB_1_3",
    title: "Konsultasi Bab 1–3",
    shortTitle: "Kons. Bab 1–3",
    description: "Konsultasikan Bab 1 sampai Bab 3 bersama pembimbing sebelum seminar proposal",
    href: "/student/skripsi-consultations",
  },
  PENGAJUAN_SEMINAR: {
    key: "PENGAJUAN_SEMINAR",
    title: "Pengajuan Seminar Proposal",
    shortTitle: "Peng. Seminar",
    description: "Upload berkas persyaratan seminar proposal Bisnis Digital",
    href: `/student/pengajuan-sidang${SEMINAR_QUERY}`,
  },
  SEMINAR: {
    key: "SEMINAR",
    title: "Seminar Proposal",
    shortTitle: "Seminar",
    description: "Pantau pelaksanaan dan hasil seminar proposal Anda",
    href: `/student/sidang${SEMINAR_QUERY}`,
  },
  REVISI_SEMINAR: {
    key: "REVISI_SEMINAR",
    title: "Revisi Pasca Seminar",
    shortTitle: "Revisi Seminar",
    description: "Upload revisi proposal dan kumpulkan tanda tangan penguji dan pembimbing",
    href: `/student/revisi-pasca-sidang${SEMINAR_QUERY}`,
  },
  SK_SKRIPSI: {
    key: "SK_SKRIPSI",
    title: "SK Penulisan Skripsi",
    shortTitle: "SK Penulisan Skripsi",
    description:
      "Diproses Kaprodi dan Sekretariat bersamaan dengan Konsultasi Bab 4–5; diperlukan sebelum pengajuan sidang skripsi",
    href: "/student/sk-skripsi",
    runsInParallel: true,
  },
  KONSULTASI_BAB_4_5: {
    key: "KONSULTASI_BAB_4_5",
    title: "Konsultasi Bab 4–5",
    shortTitle: "Kons. Bab 4–5",
    description: "Lanjutkan konsultasi Bab 4 dan Bab 5 bersama pembimbing",
    href: "/student/skripsi-consultations",
  },
  PENGAJUAN_SIDANG: {
    key: "PENGAJUAN_SIDANG",
    title: "Pengajuan Sidang Skripsi",
    shortTitle: "Peng. Sidang",
    description: "Upload berkas persyaratan sidang skripsi",
    href: "/student/pengajuan-sidang",
  },
  SIDANG: {
    key: "SIDANG",
    title: "Sidang Skripsi",
    shortTitle: "Sidang",
    description: "Pantau pelaksanaan dan hasil sidang skripsi Anda",
    href: "/student/sidang",
  },
  REVISI: {
    key: "REVISI",
    title: "Revisi Pasca Sidang",
    shortTitle: "Revisi",
    description: "Upload revisi skripsi dan kumpulkan tanda tangan majelis penguji",
    href: "/student/revisi-pasca-sidang",
  },
  BERKAS_FINAL: {
    key: "BERKAS_FINAL",
    title: "Pengumpulan Berkas Final",
    shortTitle: "Berkas Final",
    description: "Upload skripsi dan artikel penelitian untuk diserahkan ke seluruh penerima",
    href: "/student/berkas-final",
  },
};

// A Bisnis Digital student's first SK only covers the proposal (Bab 1–3).
const SEMINAR_OVERRIDES = {
  SK_PENELITIAN: {
    title: "SK Penulisan Proposal",
    shortTitle: "SK Penulisan Proposal",
    description: "SK pembimbing untuk penulisan proposal hingga seminar proposal",
  },
};

const SKRIPSI_PATH = [
  "OUTLINE",
  "KONSULTASI_OUTLINE",
  "SK_PENELITIAN",
  "KONSULTASI_SKRIPSI",
  "PENGAJUAN_SIDANG",
  "SIDANG",
  "REVISI",
  "BERKAS_FINAL",
];

const SEMINAR_PATH = [
  "OUTLINE",
  "KONSULTASI_OUTLINE",
  "SK_PENELITIAN",
  "KONSULTASI_BAB_1_3",
  "PENGAJUAN_SEMINAR",
  "SEMINAR",
  "REVISI_SEMINAR",
  "SK_SKRIPSI",
  "KONSULTASI_BAB_4_5",
  "PENGAJUAN_SIDANG",
  "SIDANG",
  "REVISI",
  "BERKAS_FINAL",
];

function previousNonParallel(path, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!STEP_DEFS[path[i]].runsInParallel) return path[i];
  }
  return undefined;
}

function buildSteps({ isSeminar, done, judulDitolak, sidangGagal, repeat }) {
  const path = isSeminar ? SEMINAR_PATH : SKRIPSI_PATH;
  return path.map((key, index) => {
    const previousKey = previousNonParallel(path, index);
    const step = {
      ...STEP_DEFS[key],
      ...(isSeminar ? SEMINAR_OVERRIDES[key] : undefined),
      id: index + 1,
      isDone: Boolean(done[key]),
      isLocked:
        (judulDitolak && key === "REVISI_SEMINAR") ||
        (sidangGagal && key === "REVISI") ||
        (previousKey ? !done[previousKey] : false),
    };
    if (repeat && (key === "SIDANG" || key === "REVISI")) step.repeat = true;
    return step;
  });
}

// ---- small helpers ----

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (value) => (value ? new Date(value).toISOString() : null);

const PEMBIMBING_LABELS = { PEMBIMBING_1: "Pembimbing 1", PEMBIMBING_2: "Pembimbing 2" };
const CHAPTER_LABELS = { BAB_1: "Bab 1", BAB_2: "Bab 2", BAB_3: "Bab 3", BAB_4: "Bab 4", BAB_5: "Bab 5" };
const BERKAS_FINAL_UNITS = { PERPUSTAKAAN: "Perpustakaan", LPPM: "LPPM" };
const SK_FILE_LABELS = {
  TRANSKRIP_NILAI: "Transkrip nilai",
  PENGAJUAN_DISPOSISI_PEMBIMBING: "Formulir disposisi pembimbing",
  KARTU_KONSULTASI_OUTLINE: "Kartu konsultasi outline",
  FILE_OUTLINE: "File outline",
  HALAMAN_PERSETUJUAN: "Halaman persetujuan",
};

function revisiSignerLabel(role, jenis) {
  if (jenis === SEMINAR && role === "PENGUJI_1") return "Penguji";
  return { PENGUJI_1: "Penguji 1", PENGUJI_2: "Penguji 2", ...PEMBIMBING_LABELS }[role];
}

const groupFirst = (rows, key) => {
  const map = new Map();
  for (const row of rows) if (!map.has(row[key])) map.set(row[key], row);
  return map;
};

const maxDate = (...values) => {
  const times = values.filter(Boolean).map((v) => new Date(v).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
};

// ---- data loading ----

async function loadStudent(userId) {
  const [[row]] = await db.query(
    `SELECT u.npm, ${signatureExistsSql("u.signature_image")} AS has_signature,
            m.nama, m.tahap_tugas_akhir, m.program_studi_id,
            ps.nama AS program_studi_nama, ps.kode AS program_studi_kode
     FROM users u
     JOIN mahasiswa m ON m.npm = u.npm
     LEFT JOIN program_studi ps ON ps.id = m.program_studi_id
     WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
    [userId],
  );
  return row ?? null;
}

async function loadCycle(npm) {
  const outlineId = await getCurrentOutlineId(npm);
  const cycle = { outline: null, disposisi: null, kartuOutline: null, outlineStages: [], sk: null, skFiles: [], skripsi: null };
  if (!outlineId) return cycle;

  const [[outline]] = await db.query(
    `SELECT id, judul, status, updated_at FROM outline WHERE id = ? LIMIT 1`,
    [outlineId],
  );
  cycle.outline = outline;

  const [[disposisi]] = await db.query(
    `SELECT id, outline_id, status, catatan_kaprodi, disposisi_at, updated_at,
            pembimbing1_ditetapkan_nidn, pembimbing2_ditetapkan_nidn
     FROM pengajuan_disposisi_pembimbing
     WHERE outline_id = ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [outlineId],
  );
  cycle.disposisi = disposisi ?? null;

  const [kartuRows] = await db.query(
    `SELECT id, is_completed, completed_at, updated_at
     FROM kartu_konsultasi_outline WHERE outline_id = ? ORDER BY created_at DESC`,
    [outlineId],
  );
  cycle.kartuOutline = kartuRows[0] ?? null;
  cycle.anyOutlineKartuCompleted = kartuRows.some((k) => k.is_completed === 1);
  if (cycle.kartuOutline) {
    const [stages] = await db.query(
      `SELECT id, stage, pembimbing_nidn, current_status, updated_at
       FROM konsultasi_outline_stage WHERE kartu_konsultasi_outline_id = ?`,
      [cycle.kartuOutline.id],
    );
    cycle.outlineStages = stages;
  }

  if (disposisi?.outline_id) {
    const [[sk]] = await db.query(
      `SELECT id, status, catatan_sekretariat, submission_period_id, jenis_sk, updated_at
       FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1`,
      [disposisi.outline_id],
    );
    cycle.sk = sk ?? null;
    if (sk?.status === "NEED_REVISION") {
      const [files] = await db.query(
        `SELECT file_type FROM pengajuan_sk_penelitian_files
         WHERE pengajuan_sk_penelitian_id = ? AND status = 'NEED_REUPLOAD'`,
        [sk.id],
      );
      cycle.skFiles = files;
    }
  }

  const [[skripsi]] = await db.query(
    `SELECT id, judul, status, jalur, outline_id, pembimbing1_nidn, pembimbing2_nidn, created_at
     FROM skripsi WHERE npm = ? AND outline_id = ? ORDER BY created_at DESC LIMIT 1`,
    [npm, outlineId],
  );
  cycle.skripsi = skripsi ?? null;
  return cycle;
}

async function loadSkripsiPhase(skripsi) {
  const sid = skripsi.id;
  const phase = {
    kartu: null,
    stages: [],
    pengajuan: [],
    psk: new Map(),
    sidang: [],
    revisi: new Map(),
    lanjutan: null,
    pengumpulan: null,
    confirmations: [],
  };

  const [kartuRows] = await db.query(
    `SELECT id, is_completed, completed_at, created_at FROM kartu_konsultasi_skripsi WHERE skripsi_id = ? LIMIT 1`,
    [sid],
  );
  phase.kartu = kartuRows[0] ?? null;
  if (phase.kartu) {
    const [stages] = await db.query(
      `SELECT id, chapter_group, stage, pembimbing_nidn, current_status, updated_at
       FROM konsultasi_skripsi_stage WHERE kartu_konsultasi_skripsi_id = ?`,
      [phase.kartu.id],
    );
    phase.stages = stages;
  }

  const [pengajuan] = await db.query(
    `SELECT id, jenis, status, ujian_ke, submitted_at, catatan_sekretariat, created_at, updated_at
     FROM pengajuan_sidang WHERE skripsi_id = ?`,
    [sid],
  );
  phase.pengajuan = pengajuan;
  if (pengajuan.length) {
    const [pskRows] = await db.query(
      `SELECT pengajuan_sidang_id, status, catatan_kaprodi, tanggal_sidang, waktu_sidang, tempat_sidang,
              penguji1_nidn, penguji2_nidn, reviewed_at, updated_at
       FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id IN (?)`,
      [pengajuan.map((p) => p.id)],
    );
    for (const r of pskRows) phase.psk.set(r.pengajuan_sidang_id, r);
  }

  const [sidang] = await db.query(
    `SELECT id, jenis, pengajuan_sidang_id, status, hasil_sidang, judul_baru, updated_at
     FROM sidang WHERE skripsi_id = ?`,
    [sid],
  );
  phase.sidang = sidang;
  if (sidang.length) {
    const [revisiRows] = await db.query(
      `SELECT id, sidang_id, is_completed, updated_at FROM revisi_pasca_sidang WHERE sidang_id IN (?)`,
      [sidang.map((s) => s.id)],
    );
    for (const r of revisiRows) phase.revisi.set(r.sidang_id, r);
  }

  const [[lanjutan]] = await db.query(
    `SELECT status, created_at, forwarded_at FROM pengajuan_sk_skripsi_lanjutan WHERE skripsi_id = ? LIMIT 1`,
    [sid],
  );
  phase.lanjutan = lanjutan ?? null;

  const [[pengumpulan]] = await db.query(
    `SELECT id, status, is_completed, updated_at FROM pengumpulan_berkas_final WHERE skripsi_id = ? LIMIT 1`,
    [sid],
  );
  phase.pengumpulan = pengumpulan ?? null;
  if (pengumpulan) {
    const [confirmations] = await db.query(
      `SELECT recipient_role, confirmed_at FROM pengumpulan_berkas_final_confirmations WHERE pengumpulan_id = ?`,
      [pengumpulan.id],
    );
    phase.confirmations = confirmations;
  }
  return phase;
}

const latestRow = (rows) => rows.reduce((best, r) => (!best || Number(r.id) > Number(best.id) ? r : best), null);

// Mirrors getActivePengajuanSidang (sidangScope.service.js) on rows already loaded.
function activePengajuan(rows, jenis) {
  const ofJenis = rows
    .filter((r) => r.jenis === jenis)
    .sort((a, b) => {
      const ea = NON_EDITABLE_PENGAJUAN_STATUSES.includes(a.status) ? 1 : 0;
      const eb = NON_EDITABLE_PENGAJUAN_STATUSES.includes(b.status) ? 1 : 0;
      if (ea !== eb) return ea - eb;
      const t = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return t !== 0 ? t : Number(b.id) - Number(a.id);
    });
  return ofJenis[0] ?? null;
}

const latestOfJenis = (rows, jenis) => latestRow(rows.filter((r) => r.jenis === jenis));

async function dosenNames(nidns) {
  const unique = [...new Set(nidns.filter(Boolean))];
  if (!unique.length) return new Map();
  const [rows] = await db.query(`SELECT nidn, nama FROM dosen WHERE nidn IN (?)`, [unique]);
  return new Map(rows.map((r) => [r.nidn, r.nama]));
}

async function findWindow(table, jenis, now) {
  const [[row]] = await db.query(
    `SELECT open_at, close_at FROM ${table}
     WHERE close_at >= CURRENT_TIMESTAMP ${jenis ? "AND jenis = ?" : ""}
     ORDER BY open_at ASC LIMIT 1`,
    jenis ? [jenis] : [],
  );
  if (!row) return null;
  return {
    openAt: row.open_at,
    closeAt: row.close_at,
    isOpen: new Date(row.open_at).getTime() <= now.getTime(),
  };
}

// ---- journey state ----

function computeJourneyState(S) {
  const { cycle, phase } = S;
  const skripsi = cycle.skripsi;
  const done = {};
  let judulDitolak = false;
  let sidangGagal = false;

  done.OUTLINE = ["ACCEPTED", "APPROVED"].includes(cycle.disposisi?.status);
  done.KONSULTASI_OUTLINE = Boolean(cycle.anyOutlineKartuCompleted);
  if (cycle.disposisi?.outline_id) done.SK_PENELITIAN = cycle.sk?.status === "COMPLETED";

  // Before the SK creates the skripsi record, the KRS tahap decides the path (legacy used 8 steps here).
  const isSeminar = skripsi ? skripsi.jalur === SEMINAR : isSeminarTahap(S.tahap);
  if (skripsi) {
    const kartuDone = phase.kartu?.is_completed === 1;
    done.KONSULTASI_SKRIPSI = kartuDone;
    done.KONSULTASI_BAB_4_5 = kartuDone;

    let skripsiPhaseOpen = !isSeminar;
    if (isSeminar) {
      done.KONSULTASI_BAB_1_3 = phase.stages.some(
        (s) => s.chapter_group === "BAB_3" && s.stage === "PEMBIMBING_1" && s.current_status === "ACCEPTED",
      );
      if (done.KONSULTASI_BAB_1_3) {
        const seminar = latestOfJenis(phase.sidang, SEMINAR);
        done.PENGAJUAN_SEMINAR = Boolean(seminar);
        done.SEMINAR = seminar?.status === "COMPLETED";
        judulDitolak = seminar?.hasil_sidang === "JUDUL_DITOLAK" && skripsi.outline_id === cycle.disposisi?.outline_id;
        if (done.SEMINAR && !judulDitolak) {
          done.REVISI_SEMINAR = Boolean(seminar && phase.revisi.get(seminar.id)?.is_completed);
        }
        if (done.REVISI_SEMINAR) {
          done.SK_SKRIPSI = phase.lanjutan?.status === "COMPLETED";
          skripsiPhaseOpen = true;
        }
      }
    }

    const current = S.currentJenis;
    if (skripsiPhaseOpen && kartuDone) {
      const pengajuan = activePengajuan(phase.pengajuan, current);
      done.PENGAJUAN_SIDANG = pengajuan?.status === "COMPLETED";
      if (done.PENGAJUAN_SIDANG) {
        const sidang = latestOfJenis(phase.sidang, current);
        done.SIDANG = sidang?.status === "COMPLETED";
        sidangGagal = sidang?.hasil_sidang === "GAGAL";
      }
      if (done.SIDANG && !sidangGagal) {
        const sidang = latestOfJenis(phase.sidang, current);
        done.REVISI = Boolean(sidang && phase.revisi.get(sidang.id)?.is_completed);
      }
      if (done.REVISI) done.BERKAS_FINAL = Boolean(phase.pengumpulan?.is_completed);
    }
  }

  // Ujian ulang: the newest Skripsi pengajuan is a re-exam that has no sidang yet.
  let ujianUlang = null;
  if (skripsi) {
    const pengajuan = latestOfJenis(phase.pengajuan, JENIS.SKRIPSI);
    if (pengajuan && pengajuan.ujian_ke > 1 && !phase.sidang.some((s) => s.pengajuan_sidang_id === pengajuan.id)) {
      ujianUlang = pengajuan;
    }
  }

  const steps = buildSteps({ isSeminar, done, judulDitolak, sidangGagal, repeat: Boolean(ujianUlang) });
  return { isSeminar, judulDitolak, sidangGagal, steps, ujianUlang };
}

// ---- next-step card ----

function createCardBuilder(S, J) {
  const stepByKey = new Map(J.steps.map((s) => [s.key, s]));
  const stepHref = (key) => stepByKey.get(key)?.href ?? "/student";

  const card = (stepKey, suffix, fields) => {
    const step = stepByKey.get(stepKey);
    const base = step ? `Tahap ${step.id} · ${step.title}` : "Skripsi";
    return { stepKey, stageLabel: suffix ? `${base} · ${suffix}` : base, ...fields };
  };
  return { card, stepHref, stepByKey };
}

const you = () => ({ kind: "YOU", label: "Giliran Anda" });

// `who` is the short role shown on the chip ("Pembimbing 2", "3 penerima"); full names with academic
// titles would wrap the chip into a block, so they go in `holder` and the card body instead.
function waiting(S, verb, who, since, holder = who) {
  const days = since ? Math.max(0, Math.floor((S.now.getTime() - new Date(since).getTime()) / DAY_MS)) : null;
  return {
    kind: "WAITING",
    label: `${verb} ${who}${days == null ? "" : ` · hari ke-${days + 1}`}`,
    holder,
    days,
  };
}

const withName = (label, name) => (name && name !== label ? `${label} (${name})` : label);

function deadlineFor(S, windowRow, text) {
  if (!windowRow) return undefined;
  const closes = new Date(windowRow.closeAt);
  const left = Math.max(0, Math.ceil((closes.getTime() - S.now.getTime()) / DAY_MS));
  return {
    text: `${text} ditutup ${formatTanggalSingkat(closes)} · ${left > 0 ? `${left} hari lagi` : "hari ini"}`,
    closesAt: closes.toISOString(),
  };
}

const FALLBACK = "Jika terlewat, ajukan pada periode berikutnya.";

function chaptersOf(S, stages, kartuDone) {
  const seminarBefore = S.currentJenis === SEMINAR;
  const list = seminarBefore ? CHAPTER_ORDER.slice(0, 3) : CHAPTER_ORDER;
  const resolved = resolveActiveKonsultasiSkripsiStage(stages);
  return list.map((group) => {
    const p1 = stages.find((s) => s.chapter_group === group && s.stage === "PEMBIMBING_1");
    if (kartuDone || p1?.current_status === "ACCEPTED") return { label: CHAPTER_LABELS[group], state: "done" };
    if (resolved.chapterGroup === group) {
      return {
        label: CHAPTER_LABELS[group],
        state: "current",
        ...(resolved.activeStatus === "NEED_REVISION" ? { hint: "· perlu perbaikan" } : {}),
      };
    }
    return { label: CHAPTER_LABELS[group], state: "todo" };
  });
}

async function latestKonsultasiOutlineReview(stageId) {
  const [[row]] = await db.query(
    `SELECT r.id, r.catatan_kartu AS text, r.reviewed_at, rf.file_name
     FROM konsultasi_outline_review r
     LEFT JOIN konsultasi_outline_review_file rf ON rf.konsultasi_outline_review_id = r.id
     WHERE r.konsultasi_outline_stage_id = ?
     ORDER BY r.submission_no DESC, r.id DESC LIMIT 1`,
    [stageId],
  );
  return row ? { ...row, apiPath: `/outline-consultations/reviews/${row.id}/file` } : null;
}

async function latestKonsultasiSkripsiReview(stageId) {
  const [[row]] = await db.query(
    `SELECT r.id, r.catatan_kartu AS text, r.reviewed_at, rf.file_name
     FROM konsultasi_skripsi_review r
     LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
     WHERE r.konsultasi_skripsi_stage_id = ?
     ORDER BY r.submission_no DESC, r.id DESC LIMIT 1`,
    [stageId],
  );
  return row ? { ...row, apiPath: `/skripsi-consultations/reviews/${row.id}/file` } : null;
}

async function latestRevisiReview(stageId) {
  const [[row]] = await db.query(
    `SELECT r.id, r.catatan AS text, r.reviewed_at, rf.file_name
     FROM revisi_pasca_sidang_reviews r
     LEFT JOIN revisi_pasca_sidang_review_file rf ON rf.revisi_pasca_sidang_review_id = r.id
     WHERE r.stage_id = ?
     ORDER BY r.submission_no DESC, r.id DESC LIMIT 1`,
    [stageId],
  );
  return row ? { ...row, apiPath: `/revisi-pasca-sidang/reviews/${row.id}/file` } : null;
}

function feedbackOf(role, from, review) {
  if (!review?.text) return undefined;
  return {
    role,
    from: from ?? null,
    date: formatTanggalSingkat(review.reviewed_at),
    text: review.text,
    ...(review.file_name ? { file: { name: review.file_name, apiPath: review.apiPath } } : {}),
  };
}

async function resolveNext(S, J) {
  const { cycle, phase, restart } = S;
  const { card, stepHref } = createCardBuilder(S, J);
  const { outline, disposisi, kartuOutline, sk, skripsi } = cycle;
  const seminarStudent = isSeminarTahap(S.tahap);
  const skName = skPenulisanName(cycle.sk?.jenis_sk ?? S.tahap);
  const outlineHref = "/student/pengajuan-outline";

  // 1. Restart
  if (restart) {
    const reason =
      restart.hasilSidang === "GAGAL"
        ? "sidang skripsi dinyatakan gagal karena terdeteksi plagiat"
        : "judul tidak diterima pada seminar proposal";
    return {
      signature: "DISPOSISI",
      next: card("OUTLINE", "Skripsi baru", {
        actor: you(),
        title: "Mulai skripsi baru",
        body: "Skripsi sebelumnya telah diarsipkan. Anda dapat mengajukan outline baru sekarang; sebaiknya Anda berdiskusi dengan Kaprodi tentang langkah berikutnya dan topik yang akan diambil.",
        notice: {
          title: `Hasil ${restart.hasilSidang === "GAGAL" ? "sidang" : "seminar proposal"}: ${restart.hasilSidang === "GAGAL" ? "Gagal" : "Judul Ditolak"}`,
          text: `Pada ${formatTanggal(restart.verdictAt)}, ${reason}.`,
        },
        checklist: {
          title: "Persiapan skripsi baru",
          items: [
            { label: "Rancang topik dan rumusan masalah baru", state: "current", owner: "YOU" },
            {
              label: "Pastikan tanda tangan digital tersimpan",
              state: S.hasSignature ? "done" : "current",
              owner: "YOU",
            },
            {
              label: "Pantau periode pengajuan SK Penulisan",
              note: "Tanggalnya akan muncul di Jadwal Penting",
              state: "todo",
              owner: "YOU",
            },
          ],
        },
        primary: { label: "Ajukan outline baru", href: outlineHref },
        secondary: { label: "Riwayat skripsi sebelumnya", href: "/student" },
      }),
    };
  }

  // 2. No outline
  if (!outline) {
    return {
      signature: "DISPOSISI",
      next: card("OUTLINE", null, {
        actor: you(),
        title: "Ajukan outline skripsi",
        body: "Mulai dengan mengajukan outline skripsi Anda. Kaprodi akan memeriksanya sebelum Anda lanjut ke pemilihan dosen pembimbing.",
        primary: { label: "Ajukan outline", href: outlineHref },
      }),
    };
  }

  // Berkas Final and later phases need the skripsi record.
  if (skripsi && skripsi.status !== "GAGAL") {
    const pembimbing = { PEMBIMBING_1: skripsi.pembimbing1_nidn, PEMBIMBING_2: skripsi.pembimbing2_nidn };
    const name = (nidn) => (nidn ? (S.names.get(nidn) ?? nidn) : null);
    const latestPengajuan = latestRow(phase.pengajuan);
    const latestSidang = latestRow(phase.sidang);
    const lanjutan = phase.lanjutan;
    const seminarFinished = latestSidang?.jenis === SEMINAR && Boolean(lanjutan);
    const skSkripsiPending = Boolean(lanjutan) && lanjutan.status !== "COMPLETED";
    const awaitingNewSidang =
      latestPengajuan && (!latestSidang || latestSidang.pengajuan_sidang_id !== latestPengajuan.id);
    const revisi = latestSidang ? (phase.revisi.get(latestSidang.id) ?? null) : null;

    const skSkripsiCard = () => {
      const sekretariat = lanjutan.status === "WAITING_SEKRETARIAT";
      return card("SK_SKRIPSI", null, {
        actor: waiting(S, "Menunggu", sekretariat ? "Sekretariat" : "Kaprodi", sekretariat ? lanjutan.forwarded_at : lanjutan.created_at),
        title: sekretariat ? "SK Penulisan Skripsi menunggu Sekretariat" : "SK Penulisan Skripsi menunggu Kaprodi",
        body: "Konsultasi Bab 4–5 sudah selesai. SK Penulisan Skripsi diperlukan sebelum Anda dapat mengajukan sidang skripsi.",
        secondary: { label: "Lihat status SK", href: stepHref("SK_SKRIPSI") },
      });
    };

    // 11. Berkas final
    if (phase.pengumpulan) {
      const p = phase.pengumpulan;
      const finalPsk = (() => {
        const s = latestOfJenis(phase.sidang, JENIS.SKRIPSI);
        return s ? (phase.psk.get(s.pengajuan_sidang_id) ?? null) : null;
      })();
      const nidnOf = (role) =>
        ({ ...pembimbing, PENGUJI_1: finalPsk?.penguji1_nidn, PENGUJI_2: finalPsk?.penguji2_nidn })[role] ?? null;
      const secondary = { label: "Lihat berkas final", href: stepHref("BERKAS_FINAL") };
      if (p.status === "COMPLETED") {
        return {
          signature: null,
          next: card("BERKAS_FINAL", null, {
            actor: { kind: "DONE", label: "Selesai" },
            title: "Skripsi Anda selesai",
            body: "Semua tahap sudah dilalui dan berkas final Anda telah diterima. Selamat atas selesainya skripsi Anda.",
            secondary,
          }),
        };
      }
      if (p.status === "DRAFT") {
        return {
          signature: "BERKAS_DRAFT",
          next: card("BERKAS_FINAL", null, {
            actor: you(),
            title: "Kirim berkas final",
            body: "Unggah file skripsi dan artikel penelitian, lalu kirim ke seluruh penerima. Berkas yang sudah dikirim tidak dapat diubah.",
            primary: { label: "Kirim berkas final", href: stepHref("BERKAS_FINAL") },
          }),
        };
      }
      const lastConfirmed = maxDate(...phase.confirmations.map((c) => c.confirmed_at));
      const since = maxDate(p.updated_at, lastConfirmed);
      if (p.status === "WAITING_SIGNATURE") {
        return {
          signature: "BERKAS_SURAT",
          next: card("BERKAS_FINAL", null, {
            actor: waiting(S, "Menunggu", "Sekretaris Prodi", since),
            title: "Menunggu tanda tangan Sekretaris Prodi",
            body: "Semua penerima sudah mengonfirmasi. Surat pernyataan penyerahan tinggal ditandatangani Sekretaris Prodi.",
            secondary,
          }),
        };
      }
      const pending = phase.confirmations.filter((c) => !c.confirmed_at);
      const holderName = (role) => BERKAS_FINAL_UNITS[role] ?? name(nidnOf(role)) ?? PEMBIMBING_LABELS[role] ?? role;
      const holders = pending.map((c) => holderName(c.recipient_role));
      return {
        signature: "BERKAS_SURAT",
        next: card("BERKAS_FINAL", null, {
          actor: waiting(S, "Menunggu konfirmasi", holders.length ? `${holders.length} penerima` : "penerima", since, holders.join(", ") || null),
          title: "Berkas final menunggu konfirmasi penerima",
          body: "Berkas final Anda sudah dikirim. Setiap penerima perlu mengonfirmasi penerimaan sebelum surat pernyataan penyerahan dibuat.",
          checklist: {
            title: "Konfirmasi penerima",
            items: phase.confirmations.map((c) => ({
              label: holderName(c.recipient_role),
              state: c.confirmed_at ? "done" : "current",
              owner: "OTHER",
            })),
          },
          secondary,
        }),
      };
    }

    // 7. Pengajuan sidang / seminar (a pengajuan that has no sidang yet)
    if (awaitingNewSidang) {
      const pj = latestPengajuan;
      const psk = phase.psk.get(pj.id) ?? null;
      const isSeminarPj = pj.jenis === SEMINAR;
      const key = isSeminarPj ? "PENGAJUAN_SEMINAR" : "PENGAJUAN_SIDANG";
      const kegiatan = isSeminarPj ? "seminar proposal" : "sidang skripsi";
      const ujianUlang = pj.ujian_ke > 1;
      const suffix = ujianUlang ? `Ujian ke-${pj.ujian_ke}` : null;
      const notice = ujianUlang
        ? {
            title: `Hasil sidang ke-${pj.ujian_ke - 1}: Tidak Lulus`,
            text: "Revisi pasca sidang Anda sudah selesai. Anda dapat langsung mengajukan ujian ulang tanpa menunggu periode pengajuan.",
          }
        : undefined;
      const href = stepHref(key);
      const secondary = { label: "Buka halaman pengajuan", href };

      const pskState = psk?.status ?? null;
      const pskSubmitted = ["SUBMITTED", "VALID", "DISPOSISI_SENT", "COMPLETED"].includes(pskState);
      const pskValid = ["VALID", "DISPOSISI_SENT", "COMPLETED"].includes(pskState);
      const afterSekretariat = NON_EDITABLE_PENGAJUAN_STATUSES.includes(pj.status);
      const checklist = {
        title: "Alur pengajuan sidang",
        items: [
          {
            label: isSeminarPj ? "Formulir dan proposal skripsi" : "Formulir dan berkas skripsi",
            state: pskSubmitted ? "done" : "current",
            owner: "YOU",
          },
          { label: "Verifikasi Kaprodi", state: pskValid ? "done" : pskState === "SUBMITTED" ? "current" : "todo", owner: "OTHER" },
          {
            label: "Unggah berkas administrasi",
            state: afterSekretariat || pj.status === "SUBMITTED" ? "done" : pskValid ? "current" : "todo",
            owner: "YOU",
          },
          {
            label: "Verifikasi Sekretariat",
            state: afterSekretariat ? "done" : pj.status === "SUBMITTED" ? "current" : "todo",
            owner: "OTHER",
          },
          {
            label: "Penetapan penguji dan surat undangan",
            state: pj.status === "COMPLETED" ? "done" : ["WAITING_FOR_DISPOSISI", "WAITING_FOR_SURAT"].includes(pj.status) ? "current" : "todo",
            owner: "OTHER",
          },
        ],
      };

      let deadline;
      if (pj.status === "DRAFT" && !ujianUlang && S.sidangWindow && S.currentJenis === pj.jenis) {
        deadline = {
          ...deadlineFor(S, S.sidangWindow, `Pengajuan ${kegiatan}`),
          fallback: FALLBACK,
        };
      }
      const base = { notice, checklist, secondary, ...(deadline ? { deadline } : {}) };

      const registrationBlock =
        !isSeminarPj && skripsi.jalur === SEMINAR && (!psk || psk.status === "DRAFT")
          ? await getSkripsiRegistrationBlock(db, skripsi.id, JENIS.SKRIPSI)
          : null;
      if (registrationBlock) {
        if (skSkripsiPending) return { signature: "KONSULTASI_SKRIPSI", next: skSkripsiCard() };
        return {
          signature: "KONSULTASI_SKRIPSI",
          next: card(key, suffix, {
            actor: you(),
            title: "Daftarkan mata kuliah Skripsi di KRS",
            body: registrationBlock,
            ...base,
            deadline: undefined,
            checklist: undefined,
          }),
        };
      }

      const signatureCode = (code) => (isSeminarPj ? `${code}_SEMINAR` : code);
      if (pj.status === "WAITING_FOR_DISPOSISI") {
        return {
          signature: signatureCode("WAITING_DISPOSISI"),
          next: card(key, suffix, {
            actor: waiting(S, "Menunggu", "Kaprodi", pj.updated_at),
            title: "Menunggu penetapan penguji",
            body: `Berkas ${kegiatan} Anda sudah diverifikasi Sekretariat. Kaprodi akan menetapkan penguji, jadwal dan tempat.`,
            ...base,
          }),
        };
      }
      if (pskState === "SUBMITTED") {
        return {
          signature: "GENERIC",
          next: card(key, suffix, {
            actor: waiting(S, "Sedang diperiksa", "Kaprodi", psk.updated_at),
            title: "Formulir pengajuan Anda sedang diperiksa Kaprodi",
            body: `Kaprodi memeriksa formulir dan berkas ${isSeminarPj ? "proposal" : "skripsi"} Anda.`,
            ...base,
          }),
        };
      }
      if (!psk || pskState === "DRAFT") {
        return {
          signature: signatureCode("PENGAJUAN_KAPRODI"),
          next: card(key, suffix, {
            actor: you(),
            title: `Lengkapi formulir pengajuan ${isSeminarPj ? "seminar" : "sidang"}`,
            body: `Isi data diri dan unggah ${isSeminarPj ? "proposal" : "berkas skripsi"}, lalu kirim ke Kaprodi untuk diperiksa.`,
            ...base,
            primary: { label: "Lengkapi formulir", href },
          }),
        };
      }
      if (pskState === "NEED_REVISION") {
        return {
          signature: signatureCode("PENGAJUAN_KAPRODI"),
          next: card(key, suffix, {
            actor: you(),
            title: "Perbaiki formulir pengajuan",
            body: "Kaprodi meminta perbaikan pada formulir atau berkas Anda. Perbaiki sesuai catatan lalu kirim ulang.",
            feedback: feedbackOf("Kaprodi", null, {
              text: psk.catatan_kaprodi,
              reviewed_at: psk.reviewed_at ?? psk.updated_at,
            }),
            ...base,
            primary: { label: "Perbaiki formulir", href },
          }),
        };
      }
      if (pj.status === "SUBMITTED") {
        return {
          signature: "GENERIC",
          next: card(key, suffix, {
            actor: waiting(S, "Sedang diperiksa", "Sekretariat", pj.updated_at),
            title: "Berkas administrasi sedang diperiksa Sekretariat",
            body: "Sekretariat memeriksa berkas administrasi Anda.",
            ...base,
          }),
        };
      }
      if (pj.status === "WAITING_FOR_SURAT") {
        return {
          signature: "GENERIC",
          next: card(key, suffix, {
            actor: waiting(S, "Menunggu", "Sekretariat", pj.updated_at),
            title: "Menunggu surat undangan",
            body: `Penguji dan jadwal ${kegiatan} sudah ditetapkan. Sekretariat sedang menyiapkan surat undangan.`,
            ...base,
          }),
        };
      }
      if (pj.status === "NEED_REVISION") {
        return {
          signature: "GENERIC",
          next: card(key, suffix, {
            actor: you(),
            title: "Unggah ulang berkas administrasi",
            body: "Sekretariat meminta beberapa berkas diperbaiki. Unggah ulang berkas yang ditandai lalu kirim kembali.",
            feedback: feedbackOf("Sekretariat", null, {
              text: pj.catatan_sekretariat,
              reviewed_at: pj.updated_at,
            }),
            ...base,
            primary: { label: "Unggah ulang berkas", href },
          }),
        };
      }
      return {
        signature: "GENERIC",
        next: card(key, suffix, {
          actor: you(),
          title: "Unggah berkas administrasi",
          body: "Kaprodi telah menyetujui formulir Anda. Lengkapi berkas administrasi lalu kirim ke Sekretariat.",
          ...base,
          primary: { label: "Unggah berkas", href },
        }),
      };
    }

    // 9 / 8. Revisi and sidang of the latest sidang (not the Seminar once its bridge exists)
    if (revisi && !seminarFinished) {
      const jenis = latestSidang.jenis;
      const isSeminarSidang = jenis === SEMINAR;
      const key = isSeminarSidang ? "REVISI_SEMINAR" : "REVISI";
      const href = stepHref(key);
      const psk = phase.psk.get(latestSidang.pengajuan_sidang_id) ?? null;
      if (revisi.is_completed === 1) {
        if (latestSidang.hasil_sidang === "LULUS") {
          return {
            signature: "BERKAS_DRAFT",
            next: card("BERKAS_FINAL", null, {
              actor: you(),
              title: "Kumpulkan berkas final",
              body: "Revisi pasca sidang Anda sudah selesai. Unggah file skripsi dan artikel penelitian untuk diserahkan ke seluruh penerima.",
              primary: { label: "Kumpulkan berkas final", href: stepHref("BERKAS_FINAL") },
            }),
          };
        }
      } else {
        const [stages] = await db.query(
          `SELECT id, signer_role, current_status, updated_at FROM revisi_pasca_sidang_stages WHERE revisi_id = ?`,
          [revisi.id],
        );
        const order = revisiStageOrderFor(jenis);
        const nidnOf = (role) =>
          ({ ...pembimbing, PENGUJI_1: psk?.penguji1_nidn, PENGUJI_2: psk?.penguji2_nidn })[role] ?? null;
        const nameOf = (role) => (nidnOf(role) ? (S.names.get(nidnOf(role)) ?? null) : null);
        const resolved = resolveActiveRevisiStage(stages, false, jenis);
        const signatureCode = isSeminarSidang
          ? "REVISI_SEMINAR"
          : latestSidang.hasil_sidang === "TIDAK_LULUS"
            ? "GENERIC"
            : "REVISI";
        const checklist = {
          title: "Urutan tanda tangan revisi",
          items: order.map((role) => {
            const stage = stages.find((s) => s.signer_role === role);
            return {
              label: `${revisiSignerLabel(role, jenis)}${nameOf(role) ? ` · ${nameOf(role)}` : ""}`,
              state: stage?.current_status === "APPROVED" ? "done" : resolved.activeStage === role ? "current" : "todo",
              owner: "OTHER",
            };
          }),
        };
        const secondary = { label: "Buka halaman revisi", href };
        const suffix = null;
        if (!resolved.stageRow) {
          return {
            signature: signatureCode,
            next: card(key, suffix, {
              actor: you(),
              title: "Mulai revisi pasca " + (isSeminarSidang ? "seminar" : "sidang"),
              body: "Unggah hasil revisi Anda. Revisi ditandatangani penguji dan pembimbing secara berurutan.",
              checklist,
              primary: { label: "Unggah revisi", href },
            }),
          };
        }
        const role = resolved.activeStage;
        const label = revisiSignerLabel(role, jenis);
        const who = nameOf(role) ?? label;
        if (resolved.activeStatus === "SUBMITTED") {
          return {
            signature: signatureCode,
            next: card(key, suffix, {
              actor: waiting(S, "Menunggu", label, resolved.stageRow.updated_at, who),
              title: `Revisi Anda menunggu tanda tangan ${label}`,
              body: `Revisi Anda sudah diunggah dan sedang diperiksa ${withName(label, nameOf(role))}.`,
              checklist,
              secondary,
            }),
          };
        }
        const needRevision = resolved.activeStatus === "NEED_REVISION";
        return {
          signature: signatureCode,
          next: card(key, suffix, {
            actor: you(),
            title: needRevision ? `Perbaiki revisi untuk ${label}` : `Unggah revisi untuk ${label}`,
            body: needRevision
              ? `${label} meminta perbaikan pada revisi Anda. Perbaiki sesuai catatan lalu unggah kembali.`
              : `Giliran ${label} menandatangani revisi Anda. Unggah revisi terbaru agar dapat diperiksa.`,
            feedback: needRevision
              ? feedbackOf(label, nameOf(role), await latestRevisiReview(resolved.stageRow.id))
              : undefined,
            checklist,
            primary: { label: needRevision ? "Unggah revisi perbaikan" : "Unggah revisi", href },
          }),
        };
      }
    }

    if (latestSidang && !seminarFinished && latestSidang.status !== "COMPLETED") {
      const isSeminarSidang = latestSidang.jenis === SEMINAR;
      const key = isSeminarSidang ? "SEMINAR" : "SIDANG";
      const kegiatan = isSeminarSidang ? "Seminar proposal" : "Sidang";
      const psk = phase.psk.get(latestSidang.pengajuan_sidang_id) ?? null;
      const tanggal = psk?.tanggal_sidang ? startOfDay(psk.tanggal_sidang) : null;
      const secondary = { label: "Detail sidang", href: stepHref(key) };
      const signatureCode = isSeminarSidang ? "REVISI_SEMINAR" : "REVISI";
      if (latestSidang.status === "ONGOING") {
        return {
          signature: signatureCode,
          next: card(key, null, {
            actor: { kind: "WAITING", label: `${kegiatan} berlangsung · menunggu hasil penilaian`, holder: null, days: null },
            title: `${kegiatan} Anda sedang berlangsung`,
            body: "Penguji dan pembimbing sedang menilai. Hasilnya akan diumumkan setelah penilaian akhir selesai.",
            secondary,
          }),
        };
      }
      const today = startOfDay(S.now);
      if (!tanggal || tanggal.getTime() >= today.getTime()) {
        const left = tanggal ? Math.round((tanggal.getTime() - today.getTime()) / DAY_MS) : null;
        const details = [];
        if (psk?.waktu_sidang) details.push({ k: "Waktu", v: `${String(psk.waktu_sidang).slice(0, 5)} WIB` });
        if (psk?.tempat_sidang) details.push({ k: "Tempat", v: psk.tempat_sidang });
        return {
          signature: signatureCode,
          next: card(key, null, {
            actor: {
              kind: "SCHEDULED",
              label: left == null ? `${kegiatan} terjadwal` : left === 0 ? `${kegiatan} hari ini` : `${kegiatan} ${left} hari lagi`,
              holder: null,
              days: left,
            },
            title: tanggal
              ? `${kegiatan} Anda dijadwalkan ${formatHariTanggal(tanggal)}`
              : `${kegiatan} Anda sudah dijadwalkan`,
            body: "Hadir tepat waktu dan siapkan bahan presentasi. Surat undangan resmi dapat diunduh di bawah.",
            ...(details.length ? { details } : {}),
            primary: {
              label: "Unduh surat undangan",
              apiPath: `/pengajuan-sidang/${skripsi.id}/files/SURAT_UNDANGAN_SIDANG${isSeminarSidang ? SEMINAR_QUERY : ""}`,
              download: true,
            },
            secondary,
          }),
        };
      }
      const holders = [name(pembimbing.PEMBIMBING_1), name(pembimbing.PEMBIMBING_2)].filter(Boolean).join(" dan ") || "pembimbing";
      return {
        signature: signatureCode,
        next: card(key, null, {
          actor: waiting(S, "Menunggu", "pembimbing", tanggal, holders),
          title: `Jadwal ${kegiatan.toLowerCase()} sudah lewat`,
          body: `Jadwal ${formatTanggal(tanggal)} sudah terlewat, tetapi ${kegiatan.toLowerCase()} belum dimulai oleh ${holders}. Hubungi pembimbing Anda bila perlu.`,
          secondary,
        }),
      };
    }

    // 6 / 10. Konsultasi skripsi
    const kartu = phase.kartu;
    const seminarBefore = S.currentJenis === SEMINAR;
    const konsultasiKey = skripsi.jalur === SEMINAR ? (seminarBefore ? "KONSULTASI_BAB_1_3" : "KONSULTASI_BAB_4_5") : "KONSULTASI_SKRIPSI";
    const konsultasiHref = stepHref(konsultasiKey);
    const signatureCode = seminarStudent || skripsi.jalur === SEMINAR ? "KONSULTASI_SKRIPSI_SEMINAR" : "KONSULTASI_SKRIPSI";
    if (kartu?.is_completed === 1 && skSkripsiPending) {
      return { signature: "KONSULTASI_SKRIPSI", next: skSkripsiCard() };
    }
    if (kartu?.is_completed === 1 || (seminarBefore && phase.stages.some((s) => s.chapter_group === "BAB_3" && s.stage === "PEMBIMBING_1" && s.current_status === "ACCEPTED"))) {
      // Nothing pending in konsultasi but no pengajuan row exists either (it is auto-created): point the student to it.
      const key = seminarBefore ? "PENGAJUAN_SEMINAR" : "PENGAJUAN_SIDANG";
      return {
        signature: seminarBefore ? "PENGAJUAN_KAPRODI_SEMINAR" : "PENGAJUAN_KAPRODI",
        next: card(key, null, {
          actor: you(),
          title: seminarBefore ? "Ajukan seminar proposal" : "Ajukan sidang skripsi",
          body: "Konsultasi bab Anda sudah selesai. Lengkapi formulir pengajuan untuk melanjutkan.",
          primary: { label: "Mulai pengajuan", href: stepHref(key) },
        }),
      };
    }

    const skSkripsiNote = skSkripsiPending
      ? ` SK Penulisan Skripsi Anda sedang diproses ${lanjutan.status === "WAITING_SEKRETARIAT" ? "Sekretariat" : "Kaprodi"} dan diperlukan sebelum pengajuan sidang skripsi.`
      : "";
    if (!kartu) {
      return {
        signature: signatureCode,
        next: card(konsultasiKey, null, {
          actor: you(),
          title: "Mulai konsultasi skripsi",
          body: `Mulai konsultasi dengan mengunggah Bab 1 untuk ${PEMBIMBING_LABELS.PEMBIMBING_2}.${skSkripsiNote}`,
          primary: { label: "Mulai konsultasi", href: konsultasiHref },
        }),
      };
    }
    const resolved = resolveActiveKonsultasiSkripsiStage(phase.stages);
    const chapters = chaptersOf(S, phase.stages, false);
    const lastGroup = seminarBefore ? "BAB_3" : "BAB_5";
    const remainingFrom = resolved.chapterGroup ?? "BAB_1";
    const remaining = CHAPTER_ORDER.slice(CHAPTER_ORDER.indexOf(remainingFrom), CHAPTER_ORDER.indexOf(lastGroup) + 1);
    const remainingText =
      remaining.length > 1
        ? `Bab ${remaining[0].slice(-1)}–${remaining[remaining.length - 1].slice(-1)}`
        : `Bab ${remaining[0].slice(-1)}`;
    const kegiatan = seminarBefore ? "seminar proposal" : "sidang";
    const deadline =
      S.sidangWindow
        ? {
            ...deadlineFor(S, S.sidangWindow, `Pengajuan ${kegiatan}`),
            fallback: `${remainingText} belum disetujui. ${FALLBACK}`,
          }
        : undefined;
    const common = { chapters, ...(deadline ? { deadline } : {}) };
    const chapterLabel = CHAPTER_LABELS[resolved.chapterGroup] ?? "Bab 1";
    if (!resolved.stageRow) {
      return {
        signature: signatureCode,
        next: card(konsultasiKey, chapterLabel, {
          actor: you(),
          title: `Unggah ${chapterLabel}`,
          body: `Unggah bab berikutnya agar dapat diperiksa pembimbing.${skSkripsiNote}`,
          ...common,
          primary: { label: `Unggah ${chapterLabel}`, href: konsultasiHref },
        }),
      };
    }
    const role = resolved.activeStage;
    const label = PEMBIMBING_LABELS[role];
    const holder = name(pembimbing[role]) ?? label;
    if (resolved.activeStatus === "SUBMITTED") {
      return {
        signature: signatureCode,
        next: card(konsultasiKey, chapterLabel, {
          actor: waiting(S, "Sedang diperiksa", label, resolved.stageRow.updated_at, holder),
          title: `${chapterLabel} Anda sedang diperiksa ${label}`,
          body: `Anda akan diberi tahu setelah ${withName(label, holder)} selesai memeriksa.${skSkripsiNote}`,
          ...common,
          secondary: { label: "Lihat konsultasi", href: konsultasiHref },
        }),
      };
    }
    const needRevision = resolved.activeStatus === "NEED_REVISION";
    return {
      signature: signatureCode,
      next: card(konsultasiKey, chapterLabel, {
        actor: you(),
        title: needRevision ? `Perbaiki ${chapterLabel} untuk ${label}` : `Unggah ${chapterLabel} untuk ${label}`,
        body: needRevision
          ? `${label} meminta perbaikan pada ${chapterLabel}. Perbaiki sesuai catatan lalu unggah kembali.${skSkripsiNote}`
          : `Unggah ${chapterLabel} agar dapat diperiksa ${label}.${skSkripsiNote}`,
        feedback: needRevision
          ? feedbackOf(label, name(pembimbing[role]), await latestKonsultasiSkripsiReview(resolved.stageRow.id))
          : undefined,
        ...common,
        primary: { label: needRevision ? "Unggah revisi" : `Unggah ${chapterLabel}`, href: konsultasiHref },
      }),
    };
  }

  // Before the skripsi record exists: outline, disposisi, konsultasi outline, SK
  const name = (nidn) => (nidn ? (S.names.get(nidn) ?? nidn) : null);
  const skHref = stepHref("SK_PENELITIAN");

  if (sk && sk.status !== "COMPLETED") {
    if (sk.status === "SUBMITTED") {
      return {
        signature: "KONS_OUTLINE_SK",
        next: card("SK_PENELITIAN", null, {
          actor: waiting(S, "Sedang diperiksa", "Sekretariat", sk.updated_at),
          title: `${skName} sedang diperiksa Sekretariat`,
          body: "Sekretariat memeriksa berkas pengajuan Anda. SK akan diterbitkan setelah semua berkas disetujui.",
          secondary: { label: "Lihat status SK", href: skHref },
        }),
      };
    }
    if (sk.status === "NEED_REVISION") {
      return {
        signature: "KONS_OUTLINE_SK",
        next: card("SK_PENELITIAN", null, {
          actor: you(),
          title: `Unggah ulang berkas ${skName}`,
          body: "Sekretariat meminta beberapa berkas diperbaiki. Unggah ulang berkas yang ditandai lalu kirim kembali.",
          feedback: feedbackOf("Sekretariat", null, { text: sk.catatan_sekretariat, reviewed_at: sk.updated_at }),
          checklist: {
            title: "Berkas yang perlu diunggah ulang",
            items: cycle.skFiles.map((f) => ({
              label: SK_FILE_LABELS[f.file_type] ?? f.file_type,
              state: "current",
              owner: "YOU",
            })),
          },
          primary: { label: "Unggah ulang berkas", href: skHref },
        }),
      };
    }
    // DRAFT
    return skSubmissionCard(S, card, skName, skHref, "Ajukan " + skName);
  }

  if (kartuOutline) {
    if (kartuOutline.is_completed === 1) {
      return skSubmissionCard(S, card, skName, skHref, "Ajukan " + skName);
    }
    const resolved = resolveActiveKonsultasiOutlineStage(cycle.outlineStages, false);
    const href = stepHref("KONSULTASI_OUTLINE");
    if (!resolved.stageRow) {
      return {
        signature: "KONS_OUTLINE_SK",
        next: card("KONSULTASI_OUTLINE", null, {
          actor: you(),
          title: "Mulai konsultasi outline",
          body: "Unggah outline Anda agar dapat diperiksa dosen pembimbing.",
          primary: { label: "Mulai konsultasi", href },
        }),
      };
    }
    const role = resolved.activeStage;
    const label = PEMBIMBING_LABELS[role];
    const nidn = resolved.stageRow.pembimbing_nidn ?? (role === "PEMBIMBING_1" ? disposisi?.pembimbing1_ditetapkan_nidn : disposisi?.pembimbing2_ditetapkan_nidn);
    const holder = name(nidn) ?? label;
    if (resolved.activeStatus === "SUBMITTED") {
      return {
        signature: "KONS_OUTLINE_SK",
        next: card("KONSULTASI_OUTLINE", null, {
          actor: waiting(S, "Sedang diperiksa", label, resolved.stageRow.updated_at, holder),
          title: `Outline Anda sedang diperiksa ${label}`,
          body: `Anda akan diberi tahu setelah ${withName(label, holder)} selesai memeriksa.`,
          secondary: { label: "Lihat konsultasi", href },
        }),
      };
    }
    const needRevision = resolved.activeStatus === "NEED_REVISION";
    return {
      signature: "KONS_OUTLINE_SK",
      next: card("KONSULTASI_OUTLINE", null, {
        actor: you(),
        title: needRevision ? `Revisi outline untuk ${label}` : `Unggah outline untuk ${label}`,
        body: needRevision
          ? `${label} meminta perbaikan pada outline Anda. Perbaiki sesuai catatan lalu unggah kembali.`
          : `Unggah outline Anda agar dapat diperiksa ${label}.`,
        feedback: needRevision
          ? feedbackOf(label, name(nidn), await latestKonsultasiOutlineReview(resolved.stageRow.id))
          : undefined,
        primary: { label: needRevision ? "Unggah revisi outline" : "Unggah outline", href },
      }),
    };
  }

  if (disposisi) {
    const dispHref = `${outlineHref}/pengajuan-disposisi-pembimbing/${disposisi.id}`;
    if (disposisi.status === "SUBMITTED") {
      return {
        signature: "DISPOSISI",
        next: card("OUTLINE", seminarStudent ? "Topik Seminar" : "Disposisi Pembimbing", {
          actor: waiting(S, "Sedang diperiksa", "Kaprodi", disposisi.updated_at),
          title: seminarStudent ? "Pengajuan topik seminar sedang diperiksa Kaprodi" : "Pengajuan disposisi sedang diperiksa Kaprodi",
          body: "Kaprodi akan menetapkan dosen pembimbing setelah memeriksa pengajuan Anda.",
          secondary: { label: "Lihat pengajuan", href: outlineHref },
        }),
      };
    }
    if (disposisi.status === "NEED_REVISION") {
      return {
        signature: "DISPOSISI",
        next: card("OUTLINE", seminarStudent ? "Topik Seminar" : "Disposisi Pembimbing", {
          actor: you(),
          title: seminarStudent ? "Perbaiki pengajuan topik seminar" : "Perbaiki pengajuan disposisi",
          body: "Kaprodi meminta perbaikan. Perbaiki sesuai catatan lalu kirim ulang.",
          feedback: feedbackOf("Kaprodi", null, {
            text: disposisi.catatan_kaprodi,
            reviewed_at: disposisi.disposisi_at ?? disposisi.updated_at,
          }),
          primary: { label: "Perbaiki pengajuan", href: `${dispHref}/resubmit` },
        }),
      };
    }
    return {
      signature: "KONS_OUTLINE_SK",
      next: card("KONSULTASI_OUTLINE", null, {
        actor: you(),
        title: "Mulai konsultasi outline",
        body: "Dosen pembimbing sudah ditetapkan. Unggah outline Anda untuk mulai berkonsultasi.",
        primary: { label: "Mulai konsultasi", href: stepHref("KONSULTASI_OUTLINE") },
      }),
    };
  }

  const outlineFeedbackRow = async () => {
    const [[row]] = await db.query(
      `SELECT rev.decision_note AS text, rev.reviewed_at, rev.file_name
       FROM outline_submissions sub
       JOIN outline_reviews rev ON rev.submission_id = sub.id
       WHERE sub.outline_id = ?
       ORDER BY sub.submission_no DESC LIMIT 1`,
      [outline.id],
    );
    return row ? { ...row, apiPath: `/outlines/${outline.id}/files/kaprodi` } : null;
  };

  if (outline.status === "SUBMITTED") {
    return {
      signature: "DISPOSISI",
      next: card("OUTLINE", null, {
        actor: waiting(S, "Sedang diperiksa", "Kaprodi", outline.updated_at),
        title: "Outline Anda sedang diperiksa Kaprodi",
        body: "Anda akan diberi tahu setelah Kaprodi selesai memeriksa outline.",
        secondary: { label: "Lihat outline", href: outlineHref },
      }),
    };
  }
  if (outline.status === "NEED_REVISION") {
    return {
      signature: "DISPOSISI",
      next: card("OUTLINE", null, {
        actor: you(),
        title: "Revisi outline Anda",
        body: "Kaprodi meminta perbaikan pada outline. Perbaiki sesuai catatan lalu unggah kembali.",
        feedback: feedbackOf("Kaprodi", null, await outlineFeedbackRow()),
        primary: { label: "Unggah revisi outline", href: `${outlineHref}/outline/${outline.id}/resubmit` },
      }),
    };
  }
  if (outline.status === "REJECTED") {
    return {
      signature: "DISPOSISI",
      next: card("OUTLINE", null, {
        actor: you(),
        title: "Outline Anda ditolak",
        body: "Anda dapat mengajukan outline baru dengan topik yang berbeda. Sebaiknya diskusikan dengan Kaprodi terlebih dahulu.",
        feedback: feedbackOf("Kaprodi", null, await outlineFeedbackRow()),
        primary: { label: "Ajukan outline baru", href: outlineHref },
      }),
    };
  }
  // ACCEPTED, no disposisi yet
  return {
    signature: "DISPOSISI",
    next: card("OUTLINE", seminarStudent ? "Topik Seminar" : "Disposisi Pembimbing", {
      actor: you(),
      title: seminarStudent ? "Ajukan topik seminar" : "Ajukan disposisi pembimbing",
      body: seminarStudent
        ? "Outline Anda diterima. Ajukan topik seminar agar Kaprodi menetapkan dosen pembimbing."
        : "Outline Anda diterima. Ajukan disposisi pembimbing untuk memilih calon dosen pembimbing.",
      primary: {
        label: seminarStudent ? "Ajukan topik seminar" : "Ajukan disposisi",
        href: `${outlineHref}/pengajuan-disposisi-pembimbing/create`,
      },
    }),
  };
}

// SK Penulisan: gated by an open SK window (an NEED_REVISION resubmit never is).
function skSubmissionCard(S, card, skName, skHref, primaryLabel) {
  if (!S.skWindowOpen) {
    return {
      signature: "KONS_OUTLINE_SK",
      next: card("SK_PENELITIAN", null, {
        actor: { kind: "WAITING", label: "Menunggu periode pengajuan SK dibuka", holder: null, days: null },
        title: `Menunggu periode pengajuan ${skName} dibuka`,
        body: "Konsultasi outline Anda sudah selesai. Pengajuan SK hanya dapat dilakukan saat periode pengajuan dibuka; tanggalnya akan muncul di Jadwal Penting.",
        secondary: { label: "Lihat halaman SK", href: skHref },
      }),
    };
  }
  return {
    signature: "KONS_OUTLINE_SK",
    next: card("SK_PENELITIAN", null, {
      actor: you(),
      title: `Ajukan ${skName}`,
      body: "Konsultasi outline Anda sudah selesai. Ajukan SK dengan mengirim berkas yang diperlukan ke Sekretariat.",
      deadline: { ...deadlineFor(S, S.skWindow, `Pengajuan ${skName}`), fallback: FALLBACK },
      primary: { label: primaryLabel, href: skHref },
    }),
  };
}

const SIGNATURE_TEXT = {
  DISPOSISI: "Pengajuan disposisi pembimbing membutuhkan tanda tangan Anda.",
  KONS_OUTLINE_SK: "Halaman persetujuan dan SK Penulisan tidak dapat dibuat tanpa tanda tangan Anda.",
  KONSULTASI_SKRIPSI: "Pengajuan sidang ke Kaprodi tidak dapat dikirim tanpa tanda tangan Anda.",
  KONSULTASI_SKRIPSI_SEMINAR: "Pengajuan seminar proposal ke Kaprodi tidak dapat dikirim tanpa tanda tangan Anda.",
  PENGAJUAN_KAPRODI: "Pengajuan sidang ke Kaprodi tidak dapat dikirim tanpa tanda tangan Anda.",
  PENGAJUAN_KAPRODI_SEMINAR: "Pengajuan seminar proposal ke Kaprodi tidak dapat dikirim tanpa tanda tangan Anda.",
  WAITING_DISPOSISI: "Kaprodi tidak dapat menetapkan penguji sebelum tanda tangan Anda tersimpan.",
  WAITING_DISPOSISI_SEMINAR: "Kaprodi tidak dapat menetapkan penguji sebelum tanda tangan Anda tersimpan.",
  REVISI: "Halaman pengesahan setelah revisi tidak dapat dibuat tanpa tanda tangan Anda.",
  REVISI_SEMINAR: "Dokumen setelah seminar proposal tidak dapat dibuat tanpa tanda tangan Anda jika judul diubah.",
  BERKAS_DRAFT: "Berkas final tidak dapat dikirim tanpa tanda tangan Anda.",
  BERKAS_SURAT: "Surat pernyataan penyerahan tidak dapat dibuat tanpa tanda tangan Anda.",
  GENERIC: "Dokumen pada tahap berikutnya tidak dapat dibuat tanpa tanda tangan Anda.",
};

function signatureBlockFor(S, code) {
  if (S.hasSignature || code === null) return null;
  let key = code ?? "GENERIC";
  // The Kaprodi disposisi only needs the student's signature when it regenerates a document that
  // carries it (Lembar Usulan Penguji, Surat Permohonan Seminar); Bisnis Digital Skripsi has none.
  if (key === "WAITING_DISPOSISI" && S.programStudiKode === BISNIS_DIGITAL_PROGRAM_STUDI_KODE) key = "GENERIC";
  return `${SIGNATURE_TEXT[key] ?? SIGNATURE_TEXT.GENERIC} Simpan sekarang agar tidak tertahan.`;
}

// ---- sidebar blocks ----

function buildSkripsiBlock(S, J) {
  const { cycle, phase } = S;
  const { outline, disposisi, skripsi } = cycle;
  if (J.restart) return { skripsi: null };
  const judul = skripsi?.judul ?? outline?.judul ?? null;
  if (!judul) return { skripsi: null };
  const people = [];
  const approved = ["ACCEPTED", "APPROVED"].includes(disposisi?.status);
  const p1 = skripsi?.pembimbing1_nidn ?? (approved ? disposisi.pembimbing1_ditetapkan_nidn : null);
  const p2 = skripsi?.pembimbing2_nidn ?? (approved ? disposisi.pembimbing2_ditetapkan_nidn : null);
  if (p1) people.push({ role: "Pembimbing 1", name: S.names.get(p1) ?? p1 });
  if (p2) people.push({ role: "Pembimbing 2", name: S.names.get(p2) ?? p2 });
  if (skripsi) {
    const pj = activePengajuan(phase.pengajuan, S.currentJenis);
    const psk = pj ? (phase.psk.get(pj.id) ?? null) : null;
    const finalCommittee = psk && ["DISPOSISI_SENT", "COMPLETED"].includes(psk.status);
    const hasPenguji2 = S.currentJenis !== SEMINAR;
    const slots = [
      ["Penguji 1", psk?.penguji1_nidn],
      ...(hasPenguji2 ? [["Penguji 2", psk?.penguji2_nidn]] : []),
    ];
    for (const [role, nidn] of slots) {
      const label = S.currentJenis === SEMINAR ? "Penguji" : role;
      if (finalCommittee && nidn) people.push({ role: label, name: S.names.get(nidn) ?? nidn });
      else people.push({ role: label, name: "Ditetapkan saat pengajuan sidang", muted: true });
    }
  }
  return { skripsi: { judul, people } };
}

async function buildDates(S, J) {
  const dates = [];
  const { cycle, phase } = S;
  if (J.restart) return dates;
  const skName = skPenulisanName(cycle.sk?.jenis_sk ?? S.tahap);
  const range = (w) => `${formatTanggalSingkat(w.openAt)} – ${formatTanggalSingkat(w.closeAt)}`;
  const note = (w) => (w.isOpen ? "Sedang dibuka" : `Dibuka ${formatTanggalSingkat(w.openAt)}`);

  const beforeSkSubmit = !cycle.sk || cycle.sk.status === "DRAFT";
  if (cycle.outline && beforeSkSubmit && S.skWindowAny) {
    dates.push({ label: `Pengajuan ${skName}`, value: range(S.skWindowAny), note: note(S.skWindowAny) });
  }

  if (cycle.skripsi && S.sidangWindowAny) {
    const pj = activePengajuan(phase.pengajuan, S.currentJenis);
    const beforeFirst = !pj || (pj.ujian_ke === 1 && pj.status === "DRAFT");
    if (beforeFirst) {
      const kegiatan = S.currentJenis === SEMINAR ? "seminar proposal" : "sidang skripsi";
      dates.push({ label: `Pengajuan ${kegiatan}`, value: range(S.sidangWindowAny), note: note(S.sidangWindowAny) });
    }
  }

  const lanjutan = phase?.lanjutan;
  if (lanjutan && lanjutan.status !== "COMPLETED") {
    dates.push({
      label: "SK Penulisan Skripsi",
      value: lanjutan.status === "WAITING_SEKRETARIAT" ? "Menunggu Sekretariat" : "Menunggu Kaprodi",
      note: "Diproses bersamaan dengan Bab 4–5",
    });
  }

  if (cycle.skripsi) {
    const sidang = latestRow(phase.sidang);
    if (sidang && sidang.status !== "COMPLETED") {
      const psk = phase.psk.get(sidang.pengajuan_sidang_id);
      if (psk?.tanggal_sidang) {
        const waktu = psk.waktu_sidang ? ` · ${String(psk.waktu_sidang).slice(0, 5)} WIB` : "";
        dates.push({
          label: sidang.jenis === SEMINAR ? "Seminar proposal" : "Sidang skripsi",
          value: `${formatTanggalSingkat(psk.tanggal_sidang)}${waktu}`,
          tone: "scheduled",
        });
      }
    }
  }
  return dates;
}

async function loadActivity(userId) {
  const [rows] = await db.query(
    `SELECT id, message, link, is_read, created_at
     FROM notifications WHERE user_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 5`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    link: r.link ?? null,
    isRead: Boolean(r.is_read),
    createdAt: iso(r.created_at),
  }));
}

function progressTextOf(J) {
  const total = J.steps.length;
  if (J.restart) return "Skripsi baru";
  if (J.ujianUlang) {
    const active = J.steps.find((s) => !s.isDone && !s.isLocked && !s.runsInParallel);
    return `Ujian ke-${J.ujianUlang.ujian_ke} · tahap ${active?.id ?? J.steps.findIndex((s) => !s.isDone) + 1} dari ${total}`;
  }
  return `${J.steps.filter((s) => s.isDone).length} dari ${total} tahap selesai`;
}

async function getStudentDashboard(userId) {
  const student = await loadStudent(userId);
  if (!student) return null;
  const { npm } = student;

  const [[{ now }]] = await db.query("SELECT NOW() AS now");
  const cycle = await loadCycle(npm);
  const phase = cycle.skripsi
    ? await loadSkripsiPhase(cycle.skripsi)
    : { kartu: null, stages: [], pengajuan: [], psk: new Map(), sidang: [], revisi: new Map(), lanjutan: null, pengumpulan: null, confirmations: [] };
  const currentJenis = cycle.skripsi ? await resolveJenis(db, cycle.skripsi.id) : JENIS.SKRIPSI;

  const restartRaw = await getRestartStatus(npm);
  const { outlineId: failedOutlineId, ...restartInfo } = restartRaw ?? {};
  const restart =
    restartRaw && cycle.outline && failedOutlineId === cycle.outline.id
      ? { hasilSidang: restartInfo.hasilSidang, verdictAt: iso(restartInfo.verdictAt) }
      : null;

  const S = {
    now: new Date(now),
    npm,
    tahap: student.tahap_tugas_akhir,
    hasSignature: Boolean(student.has_signature),
    programStudiKode: student.program_studi_kode,
    cycle,
    phase,
    currentJenis,
    restart,
    names: new Map(),
  };

  const journeyState = computeJourneyState(S);
  const J = { ...journeyState, restart };

  const nidns = [
    cycle.skripsi?.pembimbing1_nidn,
    cycle.skripsi?.pembimbing2_nidn,
    cycle.disposisi?.pembimbing1_ditetapkan_nidn,
    cycle.disposisi?.pembimbing2_ditetapkan_nidn,
    ...cycle.outlineStages.map((s) => s.pembimbing_nidn),
    ...[...phase.psk.values()].flatMap((p) => [p.penguji1_nidn, p.penguji2_nidn]),
  ];
  S.names = await dosenNames(nidns);

  const skWindowRes = await getSkSubmissionPeriod(db);
  S.skWindowOpen = Boolean(skWindowRes.period);
  S.skWindow = skWindowRes.period;
  S.sidangWindow = cycle.skripsi ? await getOpenSidangPeriod(currentJenis) : null;
  S.skWindowAny = await findWindow("outline_submission_period", null, S.now);
  S.sidangWindowAny = cycle.skripsi ? await findWindow("sidang_submission_period", currentJenis, S.now) : null;

  const { next, signature } = await resolveNext(S, J);

  const activeStep = J.steps.find((s) => !s.isDone && !s.isLocked && !s.runsInParallel) ?? null;

  // While restarting, `steps` still describes the archived attempt (Alur Skripsi links to its pages);
  // the dashboard tracker shows the new attempt instead, which starts at Pengajuan Outline.
  let tracker = null;
  if (restart) {
    const trackerSeminar = isSeminarTahap(S.tahap);
    tracker = {
      isSeminar: trackerSeminar,
      steps: buildSteps({ isSeminar: trackerSeminar, done: {}, judulDitolak: false, sidangGagal: false, repeat: false }),
      activeKey: "OUTLINE",
    };
  }
  const { skripsi: skripsiBlock } = buildSkripsiBlock(S, J);

  let previousSkripsi = null;
  if (restart) {
    previousSkripsi = { judul: cycle.skripsi?.judul ?? cycle.outline?.judul ?? null, archivedAt: restart.verdictAt };
  }

  return {
    profile: { nama: student.nama, npm, programStudi: student.program_studi_nama ?? null },
    jalur: cycle.skripsi?.jalur ?? (isSeminarTahap(student.tahap_tugas_akhir) ? SEMINAR : JENIS.SKRIPSI),
    journey: {
      isSeminar: J.isSeminar,
      judulDitolak: J.judulDitolak,
      restart,
      steps: J.steps,
      activeKey: activeStep?.key ?? null,
      progressText: progressTextOf(J),
      tracker,
    },
    next,
    skripsi: skripsiBlock,
    previousSkripsi,
    dates: await buildDates(S, J),
    activity: await loadActivity(userId),
    hasSignature: S.hasSignature,
    signatureBlock: signatureBlockFor(S, signature),
  };
}

module.exports = { getStudentDashboard };
