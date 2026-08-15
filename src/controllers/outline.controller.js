const db = require("../db");
const outlineService = require("../services/outline.service");
const mahasiswaService = require("../services/mahasiswa.service");

function validateJudul(judul) {
  if (judul.length < 5) return "Judul minimal 5 karakter";
  if (judul.length > 255) return "Judul maksimal 255 karakter";
  return null;
}

function validateLatarBelakang(latarBelakang) {
  if (latarBelakang.length > 1500)
    return "Latar belakang maksimal 1500 karakter";
  return null;
}

async function getKaprodiProgramStudi(userId) {
  const [urows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  const nidn = urows[0]?.nidn ?? null;
  if (!nidn) return null;

  const [prodiRows] = await db.query(
    `SELECT id, nama FROM program_studi WHERE kaprodi_nidn = ? LIMIT 1`,
    [nidn],
  );
  return prodiRows[0] ?? null;
}

exports.create = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Only students can upload outline",
      });
    }

    const { judul, latarBelakang, fileOutline, fileOutlineName } = req.body;

    if (!judul || !latarBelakang || !fileOutline) {
      return res.status(400).json({
        ok: false,
        message: "Judul, latar belakang, dan file outline wajib diisi",
      });
    }

    const judulError = validateJudul(String(judul).trim());
    if (judulError) {
      return res.status(400).json({ ok: false, message: judulError });
    }

    const latarBelakangError = validateLatarBelakang(
      String(latarBelakang).trim(),
    );
    if (latarBelakangError) {
      return res.status(400).json({ ok: false, message: latarBelakangError });
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

    // boleh lanjut hanya jika belum pernah submit, atau semua outline lama REJECTED
    const hasNonRejected = await outlineService.hasNonRejectedOutline(npm);

    if (hasNonRejected) {
      return res.status(400).json({
        ok: false,
        message: "You have an ongoing outline",
      });
    }

    // block if student has an active IN_PROGRESS skripsi
    const activeSkripsi = await outlineService.hasActiveSkripsi(npm);
    if (activeSkripsi) {
      return res.status(409).json({
        ok: false,
        message: "Anda masih memiliki skripsi yang sedang berjalan.",
      });
    }

    const submissionPeriodId = req.openPeriod?.id ?? null;

    const namaMahasiswa = await mahasiswaService.getMahasiswaNameByNpm(npm);

    await outlineService.createOutline(
      judul,
      latarBelakang,
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
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    // Mahasiswa: harus hanya miliknya
    let studentNpm = null;
    if (req.user.hasRole("STUDENT")) {
      studentNpm = await mahasiswaService.getNpmByUserId(req.user.id);
      if (!studentNpm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }
    }

    const outline = await outlineService.getOutlineDetailById(id, studentNpm);
    if (!outline) {
      return res.status(404).json({ ok: false, message: "Outline not found" });
    }

    if (req.user.hasRole("LECTURER", "KAPRODI")) {
      const relatedOutlines = await outlineService.getRejectedOutlinesByNpm(
        outline.npm,
        id,
      );

      return res.json({
        ok: true,
        data: outline,
        relatedOutlines,
      });
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
        message: "Only students can access their latest outline",
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
      return res.json({ ok: true, data: null, message: "Outline not found" });
    }

    return res.json({ ok: true, data: outline });
  } catch (err) {
    next(err);
  }
};

exports.getReviewHistory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    // access check
    if (req.user.hasRole("STUDENT")) {
      const studentNpm = await mahasiswaService.getNpmByUserId(req.user.id);
      if (!studentNpm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }
    }

    if (req.user.hasRole("LECTURER", "KAPRODI")) {
      const prodi = await getKaprodiProgramStudi(req.user.id);
      if (!prodi) {
        return res.status(403).json({
          ok: false,
          message: "You are not assigned as Kaprodi",
        });
      }

      const npm = await outlineService.getOutlineNpmInProdi(id, prodi.id);
      if (!npm) {
        return res
          .status(404)
          .json({ ok: false, message: "Outline not found" });
      }
    }

    const rows = await outlineService.getOutlineReviewHistory(id);

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    // hanya dosen (LECTURER) yang bisa jadi kaprodi
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }

    const prodi = await getKaprodiProgramStudi(req.user.id);
    if (!prodi) {
      return res.status(403).json({
        ok: false,
        message: "You are not assigned as Kaprodi",
      });
    }

    // optional filter
    const status = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q) : null;
    const tahunAkademik = req.query.tahunAkademik
      ? String(req.query.tahunAkademik)
      : null;
    const periodeAkademik = req.query.periodeAkademik
      ? String(req.query.periodeAkademik)
      : null;

    const outlines = await outlineService.listOutlinesForKaprodi({
      programStudiId: prodi.id,
      status,
      q,
      tahunAkademik,
      periodeAkademik,
    });

    return res.json({
      ok: true,
      data: {
        programStudi: prodi,
        outlines,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.reviewByKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can review outlines",
      });
    }

    const outlineId = Number(req.params.id);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    const { status, decisionNote, kaprodiFileOutline, kaprodiFileOutlineName } =
      req.body;

    const allowed = ["SUBMITTED", "NEED_REVISION", "REJECTED", "ACCEPTED"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    const note = decisionNote ? String(decisionNote).trim() : "";
    const noteRequired = status === "NEED_REVISION" || status === "REJECTED";
    if (noteRequired && note.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "decisionNote is required for NEED_REVISION or REJECTED",
      });
    }

    const kaprodiFile =
      kaprodiFileOutline !== undefined && kaprodiFileOutline !== null
        ? String(kaprodiFileOutline)
        : null;

    const prodi = await getKaprodiProgramStudi(req.user.id);
    if (!prodi) {
      return res.status(403).json({
        ok: false,
        message: "You are not assigned as Kaprodi",
      });
    }

    const inProdi = await outlineService.isOutlineInProdi(outlineId, prodi.id);
    if (!inProdi) {
      return res.status(404).json({
        ok: false,
        message: "Outline not found",
      });
    }

    await outlineService.reviewOutlineByKaprodi(
      outlineId,
      prodi.id,
      status,
      note,
      kaprodiFile,
      kaprodiFileOutlineName,
    );

    return res.json({
      ok: true,
      message: "Outline reviewed",
    });
  } catch (err) {
    next(err);
  }
};

exports.resubmit = async (req, res, next) => {
  if (!req.user.hasRole("STUDENT")) {
    return res.status(403).json({
      ok: false,
      message: "Only students can resubmit outlines",
    });
  }

  const outlineId = Number(req.params.id);
  if (!Number.isFinite(outlineId) || outlineId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid outline id" });
  }

  const { judul, latarBelakang, fileOutline, fileOutlineName } = req.body;

  const judulVal = judul !== undefined ? String(judul).trim() : null;
  const latarVal =
    latarBelakang !== undefined ? String(latarBelakang).trim() : null;
  const fileVal = fileOutline !== undefined ? String(fileOutline) : null;
  const fileNameVal =
    fileOutlineName !== undefined ? String(fileOutlineName).trim() : null;

  if (
    (judulVal === null || judulVal.length === 0) &&
    (latarVal === null || latarVal.length === 0) &&
    (fileVal === null || fileVal.length === 0) &&
    (fileNameVal === null || fileNameVal.length === 0)
  ) {
    return res.status(400).json({
      ok: false,
      message:
        "At least one of judul, latarBelakang, or fileOutline must be provided",
    });
  }

  if (judulVal !== null && judulVal.length > 0) {
    const judulError = validateJudul(judulVal);
    if (judulError) {
      return res.status(400).json({ ok: false, message: judulError });
    }
  }

  if (latarVal !== null && latarVal.length > 0) {
    const latarBelakangError = validateLatarBelakang(latarVal);
    if (latarBelakangError) {
      return res.status(400).json({ ok: false, message: latarBelakangError });
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
    return res.status(404).json({
      ok: false,
      message: "Outline not found",
    });
  }

  try {
    await outlineService.resubmitOutline(
      outlineId,
      npm,
      programStudiId,
      judulVal,
      latarVal,
      fileVal,
      fileNameVal,
    );
    return res.json({
      ok: true,
      message: "Outline resubmitted",
    });
  } catch (err) {
    next(err);
  }
};
