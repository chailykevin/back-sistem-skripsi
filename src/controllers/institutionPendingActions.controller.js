const {
  getPendingActionsForRecipientRole,
} = require("../services/institutionPendingActions.service");

// GET /perpustakaan/pending-actions
exports.getPerpustakaanPendingActions = (req, res, next) =>
  getPendingActionsForRecipientRole(
    "PERPUSTAKAAN_STAFF",
    "PERPUSTAKAAN",
    req,
    res,
    next,
  );

// GET /lppm/pending-actions
exports.getLppmPendingActions = (req, res, next) =>
  getPendingActionsForRecipientRole("LPPM", "LPPM", req, res, next);
