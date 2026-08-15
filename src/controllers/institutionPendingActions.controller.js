const institutionService = require("../services/institution.service");

// GET /perpustakaan/pending-actions
exports.getPerpustakaanPendingActions = (req, res, next) =>
  institutionService.getPendingActionsByRole(
    "PERPUSTAKAAN_STAFF",
    "PERPUSTAKAAN",
    req,
    res,
    next,
  );

// GET /lppm/pending-actions
exports.getLppmPendingActions = (req, res, next) =>
  institutionService.getPendingActionsByRole("LPPM", "LPPM", req, res, next);
