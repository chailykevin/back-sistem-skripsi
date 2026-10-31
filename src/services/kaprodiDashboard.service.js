const db = require("../db");
const {
  latestByKey,
  resolveActiveKonsultasiOutlineStage,
  resolveActiveKonsultasiSkripsiStage,
  resolveActiveRevisiStage,
} = require("../utils/workflowStage");
const { formatTanggal } = require("../utils/dates");

const DAY_MS = 24 * 60 * 60 * 1000;

const STAGE_KEYS = [
  "OUTLINE",
  "DISPOSISI",
  "KONSULTASI_OUTLINE",
  "SK_PENELITIAN",
  "KONSULTASI_SKRIPSI",
  "PENGAJUAN_SIDANG",
  "SIDANG",
  "REVISI",
  "BERKAS_FINAL",
];

const PEMBIMBING_LABELS = { PEMBIMBING_1: "Pembimbing 1", PEMBIMBING_2: "Pembimbing 2" };
const REVISI_SIGNER_LABELS = {
  PENGUJI_2: "Penguji 2",
  PENGUJI_1: "Penguji 1",
  PEMBIMBING_2: "Pembimbing 2",
  PEMBIMBING_1: "Pembimbing 1",
};
const CHAPTER_LABELS = { BAB_1: "Bab 1", BAB_2: "Bab 2", BAB_3: "Bab 3", BAB_4: "Bab 4", BAB_5: "Bab 5" };
const BERKAS_FINAL_UNITS = { PERPUSTAKAAN: "Perpustakaan", LPPM: "LPPM" };

const WAITING_ON_DOSEN_STATUSES = new Set(["SUBMITTED", "IN_REVIEW"]);

function groupBy(rows, keyField) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[keyField]) ?? [];
    list.push(row);
    map.set(row[keyField], list);
  }
  return map;
}

function maxDate(...values) {
  const times = values.filter(Boolean).map((v) => new Date(v).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function loadPipelineData(programStudiIds) {
  const [mahasiswaRows] = await db.query(
    `SELECT npm, nama FROM mahasiswa WHERE program_studi_id IN (?)`,
    [programStudiIds],
  );
  const [outlineRows] = await db.query(
    `SELECT id, npm, status, pembimbing1_nidn, pembimbing2_nidn, updated_at
     FROM outline
     WHERE program_studi_id IN (?)`,
    [programStudiIds],
  );
  const latestOutlineByNpm = latestByKey(outlineRows, "npm");
  const outlineIds = [...latestOutlineByNpm.values()].map((o) => o.id);
  const npms = [...latestOutlineByNpm.keys()];

  const data = {
    mahasiswaRows,
    latestOutlineByNpm,
    disposisiByOutlineId: new Map(),
    kartuOutlineByOutlineId: new Map(),
    outlineStagesByKartu: new Map(),
    skByOutlineId: new Map(),
    latestSkripsiByNpm: new Map(),
    kartuSkripsiBySkripsiId: new Map(),
    skripsiStagesByKartu: new Map(),
    latestPengajuanSidangBySkripsiId: new Map(),
    pskByPengajuanSidangId: new Map(),
    latestSidangBySkripsiId: new Map(),
    penilaianBySidangId: new Map(),
    notulenBySidangId: new Map(),
    revisiBySidangId: new Map(),
    revisiStagesByRevisiId: new Map(),
    pengumpulanBySkripsiId: new Map(),
    confirmationsByPengumpulanId: new Map(),
    dosenNames: new Map(),
  };
  if (outlineIds.length === 0) return data;

  const [disposisiRows] = await db.query(
    `SELECT id, outline_id, status, updated_at FROM pengajuan_disposisi_pembimbing WHERE outline_id IN (?)`,
    [outlineIds],
  );
  for (const [outlineId, row] of latestByKey(disposisiRows, "outline_id")) {
    data.disposisiByOutlineId.set(outlineId, row);
  }

  const [kartuOutlineRows] = await db.query(
    `SELECT id, outline_id, is_completed, completed_at FROM kartu_konsultasi_outline WHERE outline_id IN (?)`,
    [outlineIds],
  );
  for (const r of kartuOutlineRows) data.kartuOutlineByOutlineId.set(r.outline_id, r);
  if (kartuOutlineRows.length > 0) {
    const [stageRows] = await db.query(
      `SELECT id, kartu_konsultasi_outline_id, stage, current_status, updated_at
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)`,
      [kartuOutlineRows.map((r) => r.id)],
    );
    data.outlineStagesByKartu = groupBy(stageRows, "kartu_konsultasi_outline_id");
  }

  const [skRows] = await db.query(
    `SELECT id, outline_id, status, updated_at FROM pengajuan_sk_penelitian WHERE outline_id IN (?)`,
    [outlineIds],
  );
  for (const [outlineId, row] of latestByKey(skRows, "outline_id")) {
    data.skByOutlineId.set(outlineId, row);
  }

  const [skripsiRows] = await db.query(
    `SELECT id, npm, outline_id, status, pembimbing1_nidn, pembimbing2_nidn, created_at
     FROM skripsi
     WHERE npm IN (?)`,
    [npms],
  );
  data.latestSkripsiByNpm = latestByKey(skripsiRows, "npm");
  const skripsiIds = [...data.latestSkripsiByNpm.values()].map((s) => s.id);

  const dosenNidns = [...latestOutlineByNpm.values()]
    .flatMap((o) => [o.pembimbing1_nidn, o.pembimbing2_nidn])
    .concat([...data.latestSkripsiByNpm.values()].flatMap((s) => [s.pembimbing1_nidn, s.pembimbing2_nidn]));

  if (skripsiIds.length > 0) {
    const [kartuSkripsiRows] = await db.query(
      `SELECT id, skripsi_id, is_completed, completed_at FROM kartu_konsultasi_skripsi WHERE skripsi_id IN (?)`,
      [skripsiIds],
    );
    for (const r of kartuSkripsiRows) data.kartuSkripsiBySkripsiId.set(r.skripsi_id, r);
    if (kartuSkripsiRows.length > 0) {
      const [stageRows] = await db.query(
        `SELECT id, kartu_konsultasi_skripsi_id, chapter_group, stage, current_status, updated_at
         FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id IN (?)`,
        [kartuSkripsiRows.map((r) => r.id)],
      );
      data.skripsiStagesByKartu = groupBy(stageRows, "kartu_konsultasi_skripsi_id");
    }

    const [pengajuanSidangRows] = await db.query(
      `SELECT id, skripsi_id, status, ujian_ke, updated_at FROM pengajuan_sidang WHERE skripsi_id IN (?)`,
      [skripsiIds],
    );
    data.latestPengajuanSidangBySkripsiId = latestByKey(pengajuanSidangRows, "skripsi_id");

    const [sidangRows] = await db.query(
      `SELECT id, skripsi_id, pengajuan_sidang_id, status, hasil_sidang, updated_at
       FROM sidang
       WHERE skripsi_id IN (?)`,
      [skripsiIds],
    );
    data.latestSidangBySkripsiId = latestByKey(sidangRows, "skripsi_id");

    const pengajuanSidangIds = [
      ...[...data.latestPengajuanSidangBySkripsiId.values()].map((r) => r.id),
      ...[...data.latestSidangBySkripsiId.values()].map((r) => r.pengajuan_sidang_id),
    ].filter(Boolean);
    if (pengajuanSidangIds.length > 0) {
      const [pskRows] = await db.query(
        `SELECT id, pengajuan_sidang_id, status, tanggal_sidang, penguji1_nidn, penguji2_nidn, updated_at
         FROM pengajuan_sidang_kaprodi
         WHERE pengajuan_sidang_id IN (?)`,
        [[...new Set(pengajuanSidangIds)]],
      );
      for (const r of pskRows) {
        data.pskByPengajuanSidangId.set(r.pengajuan_sidang_id, r);
        dosenNidns.push(r.penguji1_nidn, r.penguji2_nidn);
      }
    }

    const sidangIds = [...data.latestSidangBySkripsiId.values()].map((r) => r.id);
    if (sidangIds.length > 0) {
      const [penilaianRows] = await db.query(
        `SELECT sidang_id, role, submitted_at FROM sidang_penilaian WHERE sidang_id IN (?)`,
        [sidangIds],
      );
      data.penilaianBySidangId = groupBy(penilaianRows, "sidang_id");
      const [notulenRows] = await db.query(
        `SELECT sidang_id, role, submitted_at FROM sidang_notulen WHERE sidang_id IN (?)`,
        [sidangIds],
      );
      data.notulenBySidangId = groupBy(notulenRows, "sidang_id");

      const [revisiRows] = await db.query(
        `SELECT id, sidang_id, is_completed, updated_at FROM revisi_pasca_sidang WHERE sidang_id IN (?)`,
        [sidangIds],
      );
      for (const r of revisiRows) data.revisiBySidangId.set(r.sidang_id, r);
      if (revisiRows.length > 0) {
        const [revisiStageRows] = await db.query(
          `SELECT id, revisi_id, signer_role, current_status, updated_at
           FROM revisi_pasca_sidang_stages
           WHERE revisi_id IN (?)`,
          [revisiRows.map((r) => r.id)],
        );
        data.revisiStagesByRevisiId = groupBy(revisiStageRows, "revisi_id");
      }
    }

    const [pengumpulanRows] = await db.query(
      `SELECT id, skripsi_id, status, updated_at FROM pengumpulan_berkas_final WHERE skripsi_id IN (?)`,
      [skripsiIds],
    );
    for (const r of pengumpulanRows) data.pengumpulanBySkripsiId.set(r.skripsi_id, r);
    if (pengumpulanRows.length > 0) {
      const [confirmationRows] = await db.query(
        `SELECT pengumpulan_id, recipient_role, nidn, confirmed_at
         FROM pengumpulan_berkas_final_confirmations
         WHERE pengumpulan_id IN (?)`,
        [pengumpulanRows.map((r) => r.id)],
      );
      data.confirmationsByPengumpulanId = groupBy(confirmationRows, "pengumpulan_id");
      dosenNidns.push(...confirmationRows.map((r) => r.nidn));
    }
  }

  const uniqueNidns = [...new Set(dosenNidns.filter(Boolean))];
  if (uniqueNidns.length > 0) {
    const [dosenRows] = await db.query(`SELECT nidn, nama FROM dosen WHERE nidn IN (?)`, [uniqueNidns]);
    for (const r of dosenRows) data.dosenNames.set(r.nidn, r.nama);
  }

  return data;
}

function resolveStudentPosition(npm, data, today) {
  const dosen = (nidn) => (nidn ? { type: "DOSEN", name: data.dosenNames.get(nidn) ?? nidn } : null);
  const unit = (name) => ({ type: "UNIT", name });
  const at = (stage, waitingOn, detail, lastActionAt, extra = {}) => ({
    stage,
    waitingOn,
    detail,
    lastActionAt,
    holders: [],
    href: null,
    ...extra,
  });

  const outline = data.latestOutlineByNpm.get(npm);
  if (!outline || outline.status === "REJECTED") return null;

  const skripsi = data.latestSkripsiByNpm.get(npm) ?? null;
  if (!skripsi || skripsi.outline_id !== outline.id) {
    const disposisi = data.disposisiByOutlineId.get(outline.id) ?? null;
    const kartuOutline = data.kartuOutlineByOutlineId.get(outline.id) ?? null;
    const sk = data.skByOutlineId.get(outline.id) ?? null;
    const outlineConsultHref = `/kaprodi/outline-consultations/${outline.id}`;

    if (sk) {
      if (sk.status === "SUBMITTED") {
        return at("SK_PENELITIAN", "UNIT", "Menunggu verifikasi Sekretariat", sk.updated_at, {
          holders: [unit("Sekretariat")],
        });
      }
      if (sk.status === "DRAFT") return at("SK_PENELITIAN", "MAHASISWA", "Belum mengajukan SK Penelitian", sk.updated_at);
      if (sk.status === "NEED_REVISION") return at("SK_PENELITIAN", "MAHASISWA", "Berkas perlu diunggah ulang", sk.updated_at);
      return null;
    }

    if (kartuOutline) {
      if (kartuOutline.is_completed === 1) {
        return at("SK_PENELITIAN", "MAHASISWA", "Belum mengajukan SK Penelitian", kartuOutline.completed_at);
      }
      const stages = data.outlineStagesByKartu.get(kartuOutline.id) ?? [];
      const { activeStage, activeStatus, stageRow } = resolveActiveKonsultasiOutlineStage(stages, false);
      if (!stageRow) {
        return at("KONSULTASI_OUTLINE", "MAHASISWA", "Belum memulai konsultasi outline", disposisi?.updated_at ?? outline.updated_at, {
          href: outlineConsultHref,
        });
      }
      const label = PEMBIMBING_LABELS[activeStage] ?? "";
      if (WAITING_ON_DOSEN_STATUSES.has(activeStatus)) {
        const nidn = activeStage === "PEMBIMBING_1" ? outline.pembimbing1_nidn : outline.pembimbing2_nidn;
        return at("KONSULTASI_OUTLINE", "DOSEN", `Review ${label}`, stageRow.updated_at, {
          holders: [dosen(nidn)].filter(Boolean),
          href: outlineConsultHref,
        });
      }
      return at("KONSULTASI_OUTLINE", "MAHASISWA", `${label} · belum unggah revisi`, stageRow.updated_at, {
        href: outlineConsultHref,
      });
    }

    if (disposisi) {
      const disposisiHref = `/kaprodi/pengajuan-outline/pengajuan-disposisi-pembimbing/${disposisi.id}`;
      if (disposisi.status === "SUBMITTED") {
        return at("DISPOSISI", "KAPRODI", "Menunggu review Anda", disposisi.updated_at, {
          href: `${disposisiHref}/review`,
          action: "disposisi",
        });
      }
      if (disposisi.status === "NEED_REVISION") {
        return at("DISPOSISI", "MAHASISWA", "Merevisi sesuai catatan Kaprodi", disposisi.updated_at, { href: disposisiHref });
      }
      if (disposisi.status === "APPROVED") {
        return at("KONSULTASI_OUTLINE", "MAHASISWA", "Belum memulai konsultasi outline", disposisi.updated_at, {
          href: outlineConsultHref,
        });
      }
      return null;
    }

    const outlineHref = `/kaprodi/pengajuan-outline/outlines/${outline.id}`;
    if (outline.status === "SUBMITTED") {
      return at("OUTLINE", "KAPRODI", "Menunggu review Anda", outline.updated_at, {
        href: `${outlineHref}/review`,
        action: "outline",
      });
    }
    if (outline.status === "NEED_REVISION") {
      return at("OUTLINE", "MAHASISWA", "Merevisi outline sesuai catatan Kaprodi", outline.updated_at, { href: outlineHref });
    }
    if (outline.status === "ACCEPTED") {
      return at("DISPOSISI", "MAHASISWA", "Belum mengajukan disposisi pembimbing", outline.updated_at);
    }
    return null;
  }

  if (skripsi.status === "GAGAL") return null;

  const pembimbingNidn = { PEMBIMBING_1: skripsi.pembimbing1_nidn, PEMBIMBING_2: skripsi.pembimbing2_nidn };
  const pengumpulan = data.pengumpulanBySkripsiId.get(skripsi.id) ?? null;
  const sidang = data.latestSidangBySkripsiId.get(skripsi.id) ?? null;
  const pengajuanSidang = data.latestPengajuanSidangBySkripsiId.get(skripsi.id) ?? null;
  const revisi = sidang ? (data.revisiBySidangId.get(sidang.id) ?? null) : null;
  const awaitingNewSidang = pengajuanSidang && (!sidang || sidang.pengajuan_sidang_id !== pengajuanSidang.id);

  if (pengumpulan) {
    const href = `/kaprodi/pengumpulan-berkas-final/${skripsi.id}`;
    if (pengumpulan.status === "COMPLETED") return null;
    if (pengumpulan.status === "DRAFT") {
      return at("BERKAS_FINAL", "MAHASISWA", "Belum mengirim berkas final", pengumpulan.updated_at, { href });
    }
    const confirmations = data.confirmationsByPengumpulanId.get(pengumpulan.id) ?? [];
    const lastConfirmedAt = maxDate(...confirmations.map((c) => c.confirmed_at));
    if (pengumpulan.status === "WAITING_SIGNATURE") {
      return at("BERKAS_FINAL", "UNIT", "Menunggu tanda tangan Sekretaris Prodi", maxDate(pengumpulan.updated_at, lastConfirmedAt), {
        holders: [unit("Sekretaris Prodi")],
        href,
      });
    }
    const holders = confirmations
      .filter((c) => !c.confirmed_at)
      .map((c) => (BERKAS_FINAL_UNITS[c.recipient_role] ? unit(BERKAS_FINAL_UNITS[c.recipient_role]) : dosen(c.nidn)))
      .filter(Boolean);
    return at(
      "BERKAS_FINAL",
      holders.some((h) => h.type === "DOSEN") ? "DOSEN" : "UNIT",
      `Menunggu konfirmasi ${holders.map((h) => h.name).join(", ")}`,
      maxDate(pengumpulan.updated_at, lastConfirmedAt),
      { holders, href },
    );
  }

  if (awaitingNewSidang) {
    const psk = data.pskByPengajuanSidangId.get(pengajuanSidang.id) ?? null;
    const href = `/kaprodi/pengajuan-sidang/${skripsi.id}`;
    const ujianUlang = pengajuanSidang.ujian_ke > 1 ? ` · ujian ke-${pengajuanSidang.ujian_ke}` : "";
    if (pengajuanSidang.status === "REJECTED" || psk?.status === "REJECTED") return null;
    if (pengajuanSidang.status === "WAITING_FOR_DISPOSISI") {
      return at("PENGAJUAN_SIDANG", "KAPRODI", `Menunggu disposisi Anda${ujianUlang}`, pengajuanSidang.updated_at, {
        href: `${href}/disposisi`,
        action: "disposisiSidang",
      });
    }
    if (psk?.status === "SUBMITTED") {
      return at("PENGAJUAN_SIDANG", "KAPRODI", `Menunggu review Anda${ujianUlang}`, psk.updated_at, {
        href,
        action: "sidang",
      });
    }
    if (psk && ["DRAFT", "NEED_REVISION"].includes(psk.status)) {
      const detail = psk.status === "DRAFT" ? "Melengkapi formulir pengajuan sidang" : "Merevisi sesuai catatan Kaprodi";
      return at("PENGAJUAN_SIDANG", "MAHASISWA", `${detail}${ujianUlang}`, psk.updated_at, { href });
    }
    if (pengajuanSidang.status === "SUBMITTED") {
      return at("PENGAJUAN_SIDANG", "UNIT", `Verifikasi berkas${ujianUlang}`, pengajuanSidang.updated_at, {
        holders: [unit("Sekretariat")],
        href,
      });
    }
    if (pengajuanSidang.status === "WAITING_FOR_SURAT") {
      return at("PENGAJUAN_SIDANG", "UNIT", `Menunggu surat undangan${ujianUlang}`, pengajuanSidang.updated_at, {
        holders: [unit("Sekretariat")],
        href,
      });
    }
    const detail = pengajuanSidang.status === "NEED_REVISION" ? "Berkas perlu diunggah ulang" : "Melengkapi berkas sidang";
    return at("PENGAJUAN_SIDANG", "MAHASISWA", `${detail}${ujianUlang}`, pengajuanSidang.updated_at, { href });
  }

  if (revisi) {
    const href = `/kaprodi/revisi-pasca-sidang/${skripsi.id}`;
    if (revisi.is_completed === 1) {
      if (sidang.hasil_sidang !== "LULUS") return null;
      return at("BERKAS_FINAL", "MAHASISWA", "Belum memulai pengumpulan berkas final", revisi.updated_at);
    }
    const stages = data.revisiStagesByRevisiId.get(revisi.id) ?? [];
    const { activeStage, activeStatus, stageRow } = resolveActiveRevisiStage(stages, false);
    if (!stageRow) {
      return at("REVISI", "MAHASISWA", "Belum memulai revisi", maxDate(revisi.updated_at, ...stages.map((s) => s.updated_at)), { href });
    }
    const label = `Tahap ${REVISI_SIGNER_LABELS[activeStage]}`;
    if (activeStatus === "SUBMITTED") {
      const psk = data.pskByPengajuanSidangId.get(sidang.pengajuan_sidang_id) ?? null;
      const nidn = { ...pembimbingNidn, PENGUJI_1: psk?.penguji1_nidn, PENGUJI_2: psk?.penguji2_nidn }[activeStage];
      return at("REVISI", "DOSEN", label, stageRow.updated_at, { holders: [dosen(nidn)].filter(Boolean), href });
    }
    return at("REVISI", "MAHASISWA", `${label} · belum unggah revisi`, stageRow.updated_at, { href });
  }

  if (sidang) {
    const href = `/kaprodi/sidang/${skripsi.id}`;
    if (sidang.status === "COMPLETED") return null;
    const psk = data.pskByPengajuanSidangId.get(sidang.pengajuan_sidang_id) ?? null;
    const participantNidn = {
      ...pembimbingNidn,
      PENGUJI_1: psk?.penguji1_nidn,
      PENGUJI_2: psk?.penguji2_nidn,
    };
    const pembimbingHolders = [dosen(skripsi.pembimbing1_nidn), dosen(skripsi.pembimbing2_nidn)].filter(Boolean);

    if (sidang.status === "SCHEDULED") {
      const tanggal = psk?.tanggal_sidang ? startOfDay(psk.tanggal_sidang) : null;
      if (!tanggal || tanggal >= today) {
        return at("SIDANG", "TERJADWAL", tanggal ? `Sidang ${formatTanggal(tanggal)}` : "Sidang terjadwal", null, {
          scheduledAt: tanggal,
          href,
        });
      }
      return at("SIDANG", "DOSEN", `Jadwal ${formatTanggal(tanggal)} terlewat · belum dimulai`, tanggal, {
        holders: pembimbingHolders,
        href,
      });
    }

    const penilaian = data.penilaianBySidangId.get(sidang.id) ?? [];
    const notulen = data.notulenBySidangId.get(sidang.id) ?? [];
    const missing = new Set([
      ...penilaian.filter((p) => !p.submitted_at).map((p) => p.role),
      ...notulen.filter((n) => !n.submitted_at).map((n) => n.role),
    ]);
    const lastActionAt = maxDate(
      sidang.updated_at,
      ...penilaian.map((p) => p.submitted_at),
      ...notulen.map((n) => n.submitted_at),
    );
    if (missing.size > 0) {
      const holders = ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1", "PENGUJI_2"]
        .filter((role) => missing.has(role))
        .map((role) => dosen(participantNidn[role]))
        .filter(Boolean);
      return at("SIDANG", "DOSEN", "Sidang berlangsung · penilaian belum lengkap", lastActionAt, { holders, href });
    }
    return at("SIDANG", "DOSEN", "Menunggu hasil penilaian akhir", lastActionAt, { holders: pembimbingHolders, href });
  }

  const kartuSkripsi = data.kartuSkripsiBySkripsiId.get(skripsi.id) ?? null;
  const skripsiConsultHref = `/kaprodi/skripsi-consultations/${skripsi.id}`;
  if (!kartuSkripsi) {
    return at("KONSULTASI_SKRIPSI", "MAHASISWA", "Belum memulai konsultasi skripsi", skripsi.created_at, {
      href: skripsiConsultHref,
    });
  }
  if (kartuSkripsi.is_completed === 1) {
    return at("PENGAJUAN_SIDANG", "MAHASISWA", "Belum mengajukan sidang", kartuSkripsi.completed_at, {
      href: `/kaprodi/pengajuan-sidang/${skripsi.id}`,
    });
  }
  const stages = data.skripsiStagesByKartu.get(kartuSkripsi.id) ?? [];
  const { chapterGroup, activeStage, activeStatus, stageRow } = resolveActiveKonsultasiSkripsiStage(stages);
  if (!stageRow) {
    return at(
      "KONSULTASI_SKRIPSI",
      "MAHASISWA",
      "Belum unggah bab berikutnya",
      maxDate(skripsi.created_at, ...stages.map((s) => s.updated_at)),
      { href: skripsiConsultHref },
    );
  }
  const label = `${CHAPTER_LABELS[chapterGroup]} · ${WAITING_ON_DOSEN_STATUSES.has(activeStatus) ? "review " : ""}${PEMBIMBING_LABELS[activeStage]}`;
  if (WAITING_ON_DOSEN_STATUSES.has(activeStatus)) {
    return at("KONSULTASI_SKRIPSI", "DOSEN", label, stageRow.updated_at, {
      holders: [dosen(pembimbingNidn[activeStage])].filter(Boolean),
      href: skripsiConsultHref,
    });
  }
  return at("KONSULTASI_SKRIPSI", "MAHASISWA", `${CHAPTER_LABELS[chapterGroup]} · belum unggah revisi`, stageRow.updated_at, {
    href: skripsiConsultHref,
  });
}

async function getPipeline(programStudiIds) {
  const [[{ now }]] = await db.query("SELECT NOW() AS now");
  const today = startOfDay(now);
  const data = await loadPipelineData(programStudiIds);

  const students = [];
  for (const m of data.mahasiswaRows) {
    const position = resolveStudentPosition(m.npm, data, today);
    if (!position) continue;
    const { lastActionAt, scheduledAt, ...rest } = position;
    students.push({
      npm: m.npm,
      nama: m.nama,
      ...rest,
      lastActionAt: lastActionAt ?? null,
      daysWithoutProgress: lastActionAt
        ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(lastActionAt).getTime()) / DAY_MS))
        : null,
      scheduledAt: scheduledAt ?? null,
      scheduledInDays: scheduledAt ? Math.round((scheduledAt.getTime() - today.getTime()) / DAY_MS) : null,
    });
  }

  return { generatedAt: now, stages: STAGE_KEYS, students };
}

function buildTermFilter(alias, term) {
  if (!term) return { sql: "", params: [] };
  return {
    sql: ` AND ${alias}.tahun_akademik = ? AND ${alias}.periode_akademik = ?`,
    params: [term.tahunAkademik, term.periodeAkademik],
  };
}

function emptyCounts() {
  return { you: 0, student: 0, other: 0, done: 0, rejected: 0 };
}

function classifyKonsultasi(isCompleted, activeStatus) {
  if (isCompleted) return "done";
  return WAITING_ON_DOSEN_STATUSES.has(activeStatus) ? "other" : "student";
}

async function getRecap(programStudiIds, term) {
  const osp = buildTermFilter("osp", term);
  const ssp = buildTermFilter("ssp", term);
  const counts = Object.fromEntries(STAGE_KEYS.map((k) => [k, emptyCounts()]));
  const add = (stage, bucket) => {
    if (bucket) counts[stage][bucket] += 1;
  };

  const [outlineRows] = await db.query(
    `SELECT o.status
     FROM outline o
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     WHERE o.program_studi_id IN (?)${osp.sql}`,
    [programStudiIds, ...osp.params],
  );
  const OUTLINE_BUCKET = { SUBMITTED: "you", NEED_REVISION: "student", ACCEPTED: "done", REJECTED: "rejected" };
  for (const r of outlineRows) add("OUTLINE", OUTLINE_BUCKET[r.status]);

  const [disposisiRows] = await db.query(
    `SELECT pj.status
     FROM pengajuan_disposisi_pembimbing pj
     JOIN outline o ON o.id = pj.outline_id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     WHERE o.program_studi_id IN (?)${osp.sql}`,
    [programStudiIds, ...osp.params],
  );
  const DISPOSISI_BUCKET = { SUBMITTED: "you", NEED_REVISION: "student", APPROVED: "done", REJECTED: "rejected" };
  for (const r of disposisiRows) add("DISPOSISI", DISPOSISI_BUCKET[r.status]);

  const [kartuOutlineRows] = await db.query(
    `SELECT k.id, k.is_completed
     FROM kartu_konsultasi_outline k
     JOIN outline o ON o.id = k.outline_id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     WHERE o.program_studi_id IN (?)${osp.sql}`,
    [programStudiIds, ...osp.params],
  );
  if (kartuOutlineRows.length > 0) {
    const [stageRows] = await db.query(
      `SELECT kartu_konsultasi_outline_id, stage, current_status
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)`,
      [kartuOutlineRows.map((r) => r.id)],
    );
    const stagesByKartu = groupBy(stageRows, "kartu_konsultasi_outline_id");
    for (const k of kartuOutlineRows) {
      const isCompleted = k.is_completed === 1;
      const { activeStatus } = resolveActiveKonsultasiOutlineStage(stagesByKartu.get(k.id) ?? [], isCompleted);
      add("KONSULTASI_OUTLINE", classifyKonsultasi(isCompleted, activeStatus));
    }
  }

  const [skRows] = await db.query(
    `SELECT sk.status
     FROM pengajuan_sk_penelitian sk
     JOIN outline o ON o.id = sk.outline_id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     WHERE o.program_studi_id IN (?)${osp.sql}`,
    [programStudiIds, ...osp.params],
  );
  const SK_BUCKET = {
    DRAFT: "student",
    NEED_REVISION: "student",
    SUBMITTED: "other",
    VERIFIED: "done",
    COMPLETED: "done",
    REJECTED: "rejected",
  };
  for (const r of skRows) add("SK_PENELITIAN", SK_BUCKET[r.status]);

  const [kartuSkripsiRows] = await db.query(
    `SELECT k.id, k.is_completed
     FROM kartu_konsultasi_skripsi k
     JOIN skripsi s ON s.id = k.skripsi_id
     LEFT JOIN outline o ON o.id = s.outline_id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     WHERE s.program_studi_id IN (?)${osp.sql}`,
    [programStudiIds, ...osp.params],
  );
  if (kartuSkripsiRows.length > 0) {
    const [stageRows] = await db.query(
      `SELECT kartu_konsultasi_skripsi_id, chapter_group, stage, current_status
       FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id IN (?)`,
      [kartuSkripsiRows.map((r) => r.id)],
    );
    const stagesByKartu = groupBy(stageRows, "kartu_konsultasi_skripsi_id");
    for (const k of kartuSkripsiRows) {
      const isCompleted = k.is_completed === 1;
      const { activeStatus } = isCompleted
        ? { activeStatus: null }
        : resolveActiveKonsultasiSkripsiStage(stagesByKartu.get(k.id) ?? []);
      add("KONSULTASI_SKRIPSI", classifyKonsultasi(isCompleted, activeStatus));
    }
  }

  const [pengajuanSidangRows] = await db.query(
    `SELECT ps.status, psk.status AS kaprodi_status
     FROM pengajuan_sidang ps
     JOIN skripsi s ON s.id = ps.skripsi_id
     LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = ps.id
     LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
     WHERE s.program_studi_id IN (?)${ssp.sql}`,
    [programStudiIds, ...ssp.params],
  );
  for (const r of pengajuanSidangRows) {
    let bucket;
    if (r.status === "REJECTED" || r.kaprodi_status === "REJECTED") bucket = "rejected";
    else if (["COMPLETED", "VERIFIED"].includes(r.status)) bucket = "done";
    else if (r.status === "WAITING_FOR_DISPOSISI" || r.kaprodi_status === "SUBMITTED") bucket = "you";
    else if (["DRAFT", "NEED_REVISION"].includes(r.kaprodi_status)) bucket = "student";
    else if (["SUBMITTED", "WAITING_FOR_SURAT"].includes(r.status)) bucket = "other";
    else bucket = "student";
    add("PENGAJUAN_SIDANG", bucket);
  }

  const [sidangRows] = await db.query(
    `SELECT sd.status, sd.hasil_sidang
     FROM sidang sd
     JOIN skripsi s ON s.id = sd.skripsi_id
     LEFT JOIN pengajuan_sidang ps ON ps.id = sd.pengajuan_sidang_id
     LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
     WHERE s.program_studi_id IN (?)${ssp.sql}`,
    [programStudiIds, ...ssp.params],
  );
  for (const r of sidangRows) {
    if (r.status !== "COMPLETED") add("SIDANG", "other");
    else if (r.hasil_sidang === "GAGAL") add("SIDANG", "rejected");
    else if (r.hasil_sidang === "TIDAK_LULUS") add("SIDANG", "student");
    else add("SIDANG", "done");
  }

  const [revisiRows] = await db.query(
    `SELECT r.id, r.is_completed
     FROM revisi_pasca_sidang r
     JOIN sidang sd ON sd.id = r.sidang_id
     JOIN skripsi s ON s.id = sd.skripsi_id
     LEFT JOIN pengajuan_sidang ps ON ps.id = sd.pengajuan_sidang_id
     LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
     WHERE s.program_studi_id IN (?)${ssp.sql}`,
    [programStudiIds, ...ssp.params],
  );
  if (revisiRows.length > 0) {
    const [stageRows] = await db.query(
      `SELECT revisi_id, signer_role, current_status FROM revisi_pasca_sidang_stages WHERE revisi_id IN (?)`,
      [revisiRows.map((r) => r.id)],
    );
    const stagesByRevisi = groupBy(stageRows, "revisi_id");
    for (const r of revisiRows) {
      const isCompleted = r.is_completed === 1;
      const { activeStatus } = resolveActiveRevisiStage(stagesByRevisi.get(r.id) ?? [], isCompleted);
      add("REVISI", isCompleted ? "done" : activeStatus === "SUBMITTED" ? "other" : "student");
    }
  }

  const [pengumpulanRows] = await db.query(
    `SELECT pbf.status
     FROM pengumpulan_berkas_final pbf
     JOIN skripsi s ON s.id = pbf.skripsi_id
     LEFT JOIN sidang sd ON sd.id = (
       SELECT MAX(sd2.id) FROM sidang sd2 WHERE sd2.skripsi_id = pbf.skripsi_id AND sd2.hasil_sidang = 'LULUS'
     )
     LEFT JOIN pengajuan_sidang ps ON ps.id = sd.pengajuan_sidang_id
     LEFT JOIN sidang_submission_period ssp ON ssp.id = ps.sidang_submission_period_id
     WHERE s.program_studi_id IN (?)${ssp.sql}`,
    [programStudiIds, ...ssp.params],
  );
  const BERKAS_FINAL_BUCKET = { DRAFT: "student", SUBMITTED: "other", WAITING_SIGNATURE: "other", COMPLETED: "done" };
  for (const r of pengumpulanRows) add("BERKAS_FINAL", BERKAS_FINAL_BUCKET[r.status]);

  return { stages: STAGE_KEYS.map((stage) => ({ stage, ...counts[stage] })) };
}

module.exports = { getPipeline, getRecap };
