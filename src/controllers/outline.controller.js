const db = require("../db");
const outlineService = require("../services/outline.service");
const mahasiswaService = require("../services/mahasiswa.service");
const { getOpenPeriod } = require("../services/outlineSubmissionPeriod.service");
const { getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");
const { parsePagination, buildPagination } = require("../utils/pagination");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");
const { mimeFromFileName } = require("../utils/mime");

const OUTLINE_NOT_FOUND = "Outline tidak ditemukan";
const INVALID_OUTLINE_ID = "ID outline tidak valid";
const NOT_KAPRODI = "Anda tidak terdaftar sebagai Kaprodi";

function validateJudul(judul) {
  if (judul.length < 5) return "Judul minimal 5 karakter";
  if (judul.length > 255) return "Judul maksimal 255 karakter";
  return null;
}

// Program studi the caller heads as Kaprodi (a staff account, see utils/identity.js); empty for
// anyone else, including lecturers.
async function getCallerKaprodiProgramStudiIds(req) {
  if (!req.user.hasRole("KAPRODI")) return [];
  return getKaprodiProgramStudiIds(await getStaffUsrId(req.user.id));
}

// The student who owns the outline, or the Kaprodi of its prodi. Returns { studentNpm } for the
// student (reads are then filtered by npm), {} for an authorized Kaprodi, null otherwise.
async function resolveOutlineReader(req, outlineId) {
  if (req.user.hasRole("STUDENT")) {
    const studentNpm = await mahasiswaService.getNpmByUserId(req.user.id);
    if (!studentNpm) return null;
    const owned = await outlineService.isOutlineOwnedByStudent(outlineId, studentNpm);
    return owned ? { studentNpm } : null;
  }
  const programStudiIds = await getCallerKaprodiProgramStudiIds(req);
  const inProdi = await outlineService.isOutlineInProdi(outlineId, programStudiIds);
  return inProdi ? {} : null;
}

exports.create = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat mengajukan outline",
      });
    }

    const { fileOutline, fileOutlineName } = req.body;
    const judul = req.body.judul != null ? String(req.body.judul).trim() : "";

    if (!judul || !fileOutline) {
      return res.status(400).json({
        ok: false,
        message: "Judul dan file outline wajib diisi",
      });
    }

    const judulError = validateJudul(judul);
    if (judulError) {
      return res.status(400).json({ ok: false, message: judulError });
    }

    const fileError = validateUpload(fileOutline, fileOutlineName, UPLOAD_RULES.DOCUMENT, "File outline");
    if (fileError) {
      return res.status(400).json({ ok: false, message: fileError });
    }

    // ambil npm mahasiswa dari user login
    const npm = await mahasiswaService.getNpmByUserId(req.user.id);

    if (!npm) {
      return res.status(400).json({
        ok: false,
        message: "Mahasiswa tidak valid",
      });
    }

    const programStudiId = req.user?.programStudiId ?? null;
    if (!programStudiId) {
      return res.status(400).json({
        ok: false,
        message: "Program studi tidak valid",
      });
    }

    // The one-active-outline and no-active-skripsi rules are enforced inside createOutline, under a
    // lock on the student's row (409). Outlines can be submitted any time (the period gates the SK);
    // the tag only places the outline in a term for the Kaprodi lists and recap.
    const submissionPeriodId = (await getOpenPeriod())?.id ?? null;

    const namaMahasiswa = await mahasiswaService.getMahasiswaNameByNpm(npm);

    await outlineService.createOutline(
      judul,
      npm,
      programStudiId,
      submissionPeriodId,
      fileOutline,
      fileOutlineName,
      namaMahasiswa,
    );

    res.status(201).json({
      ok: true,
      message: "Outline berhasil diupload",
    });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: INVALID_OUTLINE_ID });
    }

    const reader = await resolveOutlineReader(req, id);
    if (!reader) {
      return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
    }

    const outline = await outlineService.getOutlineDetailById(id, reader.studentNpm ?? null);
    if (!outline) {
      return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
    }

    if (!reader.studentNpm) {
      const relatedOutlines = await outlineService.getRejectedOutlinesByNpm(
        outline.npm,
        id,
      );
      return res.json({ ok: true, data: outline, relatedOutlines });
    }

    return res.json({ ok: true, data: outline });
  } catch (err) {
    next(err);
  }
};

exports.getLatestMine = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat melihat outline terbarunya",
      });
    }

    const npm = await mahasiswaService.getNpmByUserId(req.user.id);

    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const outline = await outlineService.getLatestOutlineByNpm(npm);
    if (!outline) {
      return res.json({ ok: true, data: null, message: OUTLINE_NOT_FOUND });
    }

    // Only while the failed outline is still the newest: once a new one exists the
    // student is in a fresh cycle and the normal outline states apply.
    const restart = await outlineService.getRestartStatus(npm);
    const { outlineId: failedOutlineId, ...restartInfo } = restart ?? {};
    return res.json({
      ok: true,
      data: { ...outline, restart: restart && failedOutlineId === outline.id ? restartInfo : null },
    });
  } catch (err) {
    next(err);
  }
};

exports.getReviewHistory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: INVALID_OUTLINE_ID });
    }

    if (!(await resolveOutlineReader(req, id))) {
      return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
    }

    const rows = await outlineService.getOutlineReviewHistory(id);

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /:id/files/:kind?submissionNo= — one file on demand (the outline reads only send has_file_*
// flags). kind: mahasiswa | kaprodi; no submissionNo = latest version. Same access as getById.
exports.getFile = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: INVALID_OUTLINE_ID });
    }
    const kind = String(req.params.kind ?? "").toUpperCase();
    if (kind !== "MAHASISWA" && kind !== "KAPRODI") {
      return res.status(400).json({ ok: false, message: "Jenis file tidak valid" });
    }
    let submissionNo = null;
    if (req.query.submissionNo !== undefined) {
      submissionNo = Number(req.query.submissionNo);
      if (!Number.isInteger(submissionNo) || submissionNo <= 0) {
        return res.status(400).json({ ok: false, message: "Nomor versi tidak valid" });
      }
    }

    if (!(await resolveOutlineReader(req, id))) {
      return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
    }

    const file = await outlineService.getOutlineFile(id, kind, submissionNo);
    if (!file) {
      return res.status(404).json({ ok: false, message: "File tidak ditemukan" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: file.file_name,
        mime_type: mimeFromFileName(file.file_name),
        file_content: file.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    const programStudiIds = await getCallerKaprodiProgramStudiIds(req);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: NOT_KAPRODI });
    }
    const [prodiRows] = await db.query(
      `SELECT id, nama FROM program_studi WHERE id IN (?) ORDER BY id`,
      [programStudiIds],
    );

    // optional filter
    const status = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q) : null;
    const tahunAkademik = req.query.tahunAkademik
      ? String(req.query.tahunAkademik)
      : null;
    const periodeAkademik = req.query.periodeAkademik
      ? String(req.query.periodeAkademik)
      : null;

    const pagination = parsePagination(req.query);
    const { rows: outlines, totalItems } = await outlineService.listOutlinesForKaprodi({
      programStudiIds,
      status,
      q,
      tahunAkademik,
      periodeAkademik,
      pagination,
    });

    const response = {
      ok: true,
      data: {
        programStudi: prodiRows[0] ?? null,
        programStudiList: prodiRows,
        outlines,
      },
    };
    if (pagination.enabled) {
      response.pagination = buildPagination({ ...pagination, totalItems });
    }
    return res.json(response);
  } catch (err) {
    next(err);
  }
};

exports.reviewByKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya Kaprodi yang dapat mereview outline",
      });
    }

    const outlineId = Number(req.params.id);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: INVALID_OUTLINE_ID });
    }

    const { status, decisionNote, kaprodiFileOutline, kaprodiFileOutlineName } =
      req.body;

    const allowed = ["NEED_REVISION", "REJECTED", "ACCEPTED"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Keputusan review tidak valid" });
    }

    const note = decisionNote ? String(decisionNote).trim() : "";
    const noteRequired = status === "NEED_REVISION" || status === "REJECTED";
    if (noteRequired && note.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Catatan wajib diisi untuk keputusan Perlu Revisi atau Ditolak",
      });
    }

    const kaprodiFile =
      kaprodiFileOutline != null && String(kaprodiFileOutline).length > 0
        ? String(kaprodiFileOutline)
        : null;
    if (kaprodiFile) {
      const fileError = validateUpload(
        kaprodiFile,
        kaprodiFileOutlineName,
        UPLOAD_RULES.DOCUMENT,
        "File outline Kaprodi",
      );
      if (fileError) {
        return res.status(400).json({ ok: false, message: fileError });
      }
    }

    const programStudiIds = await getCallerKaprodiProgramStudiIds(req);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: NOT_KAPRODI });
    }

    const inProdi = await outlineService.isOutlineInProdi(outlineId, programStudiIds);
    if (!inProdi) {
      return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
    }

    await outlineService.reviewOutlineByKaprodi(
      outlineId,
      status,
      note,
      kaprodiFile,
      kaprodiFileOutlineName,
    );

    return res.json({
      ok: true,
      message: "Review outline tersimpan",
    });
  } catch (err) {
    next(err);
  }
};

exports.resubmit = async (req, res, next) => {
  if (!req.user.hasRole("STUDENT")) {
    return res.status(403).json({
      ok: false,
      message: "Hanya mahasiswa yang dapat mengajukan ulang outline",
    });
  }

  const outlineId = Number(req.params.id);
  if (!Number.isFinite(outlineId) || outlineId <= 0) {
    return res.status(400).json({ ok: false, message: INVALID_OUTLINE_ID });
  }

  const { judul, fileOutline, fileOutlineName } = req.body;

  const judulVal = judul != null ? String(judul).trim() : null;
  const fileVal = fileOutline != null ? String(fileOutline) : null;
  const fileNameVal =
    fileOutlineName != null ? String(fileOutlineName).trim() : null;

  // Every resubmit is a new version: Kaprodi's review is stored per version, so a resubmit
  // without a file would make the next review overwrite the previous round's note and file.
  if (fileVal === null || fileVal.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      message: "File outline revisi wajib diunggah",
    });
  }
  const fileError = validateUpload(fileVal, fileNameVal, UPLOAD_RULES.DOCUMENT, "File outline");
  if (fileError) {
    return res.status(400).json({ ok: false, message: fileError });
  }

  if (judulVal !== null && judulVal.length > 0) {
    const judulError = validateJudul(judulVal);
    if (judulError) {
      return res.status(400).json({ ok: false, message: judulError });
    }
  }

  // ambil npm dari user login
  const npm = await mahasiswaService.getNpmByUserId(req.user.id);

  if (!npm) {
    return res.status(400).json({
      ok: false,
      message: "Mahasiswa tidak valid",
    });
  }

  const programStudiId = req.user?.programStudiId ?? null;
  if (!programStudiId) {
    return res.status(400).json({
      ok: false,
      message: "Program studi tidak valid",
    });
  }

  // pastikan outline milik mahasiswa ini
  const owned = await outlineService.isOutlineOwnedByStudent(outlineId, npm);
  if (!owned) {
    return res.status(404).json({ ok: false, message: OUTLINE_NOT_FOUND });
  }

  try {
    await outlineService.resubmitOutline(
      outlineId,
      npm,
      programStudiId,
      judulVal,
      fileVal,
      fileNameVal,
    );
    return res.json({
      ok: true,
      message: "Outline berhasil diajukan ulang",
    });
  } catch (err) {
    next(err);
  }
};
