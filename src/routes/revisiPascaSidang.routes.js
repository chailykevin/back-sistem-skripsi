const router = require("express").Router();
const c = require("../controllers/revisiPascaSidang.controller");
const auth = require("../middlewares/auth");

router.get("/lecturer/revisi-pasca-sidang", auth, c.getLecturerRevisi);
router.post("/revisi-pasca-sidang/:skripsiId/init", auth, c.initRevisi);
router.post("/revisi-pasca-sidang/:skripsiId/submit", auth, c.submitRevisi);
router.post("/revisi-pasca-sidang/:skripsiId/review", auth, c.reviewRevisi);
router.get("/revisi-pasca-sidang/:skripsiId", auth, c.getRevisi);
router.get("/revisi-pasca-sidang/:skripsiId/files/submission", auth, c.getSubmissionFile);
router.get("/revisi-pasca-sidang/:skripsiId/files/halaman-pengesahan-majelis-penguji", auth, c.getHalamanMajelisFile);
router.get("/revisi-pasca-sidang/:skripsiId/files/halaman-pengesahan-dekan", auth, c.getHalamanDekanFile);

module.exports = router;
