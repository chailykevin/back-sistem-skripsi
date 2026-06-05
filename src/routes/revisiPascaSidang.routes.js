const router = require("express").Router();
const c = require("../controllers/revisiPascaSidang.controller");
const auth = require("../middlewares/auth");

router.get("/lecturer/revisi-pasca-sidang", auth, c.getLecturerRevisi);
router.post("/revisi-pasca-sidang/:pengajuanJudulId/init", auth, c.initRevisi);
router.post("/revisi-pasca-sidang/:pengajuanJudulId/submit", auth, c.submitRevisi);
router.post("/revisi-pasca-sidang/:pengajuanJudulId/review", auth, c.reviewRevisi);
router.get("/revisi-pasca-sidang/:pengajuanJudulId", auth, c.getRevisi);
router.get("/revisi-pasca-sidang/:pengajuanJudulId/files/submission", auth, c.getSubmissionFile);
router.get("/revisi-pasca-sidang/:pengajuanJudulId/files/halaman-pengesahan-majelis-penguji", auth, c.getHalamanMajelisFile);
router.get("/revisi-pasca-sidang/:pengajuanJudulId/files/halaman-pengesahan-dekan", auth, c.getHalamanDekanFile);

module.exports = router;
