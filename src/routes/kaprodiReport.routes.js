const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/kaprodiReport.controller");

router.get("/kaprodi/reports/outline.xlsx", auth, c.exportOutlineReport);
router.get(
  "/kaprodi/reports/disposisi-pembimbing.xlsx",
  auth,
  c.exportDisposisiReport,
);
router.get(
  "/kaprodi/reports/konsultasi-outline.xlsx",
  auth,
  c.exportKonsultasiOutlineReport,
);
router.get(
  "/kaprodi/reports/konsultasi-skripsi.xlsx",
  auth,
  c.exportKonsultasiSkripsiReport,
);
router.get(
  "/kaprodi/reports/overall-progress.xlsx",
  auth,
  c.exportOverallProgressReport,
);

module.exports = router;
