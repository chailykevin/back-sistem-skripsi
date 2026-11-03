const kaprodiDashboardService = require("../services/kaprodiDashboard.service");
const { getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");

const TAHUN_AKADEMIK_PATTERN = /^\d{4}\/\d{4}$/;
const PERIODE_AKADEMIK = ["GANJIL", "GENAP"];

async function resolveProgramStudiIds(req, res) {
  if (!req.user.hasRole("KAPRODI")) {
    res.status(403).json({ ok: false, message: "Only kaprodi can access this endpoint" });
    return null;
  }
  const staffUsrId = await getStaffUsrId(req.user.id);
  if (!staffUsrId) {
    res.status(400).json({ ok: false, message: "Data dosen tidak valid" });
    return null;
  }
  const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
  if (programStudiIds.length === 0) {
    res.status(403).json({ ok: false, message: "You are not assigned as Kaprodi" });
    return null;
  }
  return programStudiIds;
}

exports.getPipeline = async (req, res, next) => {
  try {
    const programStudiIds = await resolveProgramStudiIds(req, res);
    if (!programStudiIds) return;
    const data = await kaprodiDashboardService.getPipeline(programStudiIds);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getRecap = async (req, res, next) => {
  try {
    const tahunAkademik = req.query.tahunAkademik ? String(req.query.tahunAkademik) : null;
    const periodeAkademik = req.query.periodeAkademik ? String(req.query.periodeAkademik) : null;
    if (Boolean(tahunAkademik) !== Boolean(periodeAkademik)) {
      return res
        .status(400)
        .json({ ok: false, message: "tahunAkademik dan periodeAkademik harus diisi bersamaan" });
    }
    if (tahunAkademik && (!TAHUN_AKADEMIK_PATTERN.test(tahunAkademik) || !PERIODE_AKADEMIK.includes(periodeAkademik))) {
      return res.status(400).json({ ok: false, message: "Periode tidak valid" });
    }

    const programStudiIds = await resolveProgramStudiIds(req, res);
    if (!programStudiIds) return;
    const term = tahunAkademik ? { tahunAkademik, periodeAkademik } : null;
    const data = await kaprodiDashboardService.getRecap(programStudiIds, term);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
