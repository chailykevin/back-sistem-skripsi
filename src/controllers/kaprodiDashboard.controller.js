const kaprodiDashboardService = require("../services/kaprodiDashboard.service");
const { parseTermQuery } = require("../services/academicTerm.service");
const { getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");

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

// ?tahunAkademik=&periodeAkademik= selects a cohort (the term students started in); omitted = everyone.
exports.getPipeline = async (req, res, next) => {
  try {
    const term = parseTermQuery(req.query);
    const programStudiIds = await resolveProgramStudiIds(req, res);
    if (!programStudiIds) return;
    const data = await kaprodiDashboardService.getPipeline(programStudiIds, term);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getRecap = async (req, res, next) => {
  try {
    const term = parseTermQuery(req.query);
    const programStudiIds = await resolveProgramStudiIds(req, res);
    if (!programStudiIds) return;
    const data = await kaprodiDashboardService.getRecap(programStudiIds, term);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getCohorts = async (req, res, next) => {
  try {
    const programStudiIds = await resolveProgramStudiIds(req, res);
    if (!programStudiIds) return;
    const data = await kaprodiDashboardService.getCohorts(programStudiIds);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
