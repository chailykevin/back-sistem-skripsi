const router = require("express").Router();
const c = require("../controllers/sidang.controller");
const auth = require("../middlewares/auth");

router.get("/lecturer/sidang", auth, c.getLecturerSidang);
router.get("/sidang/:pengajuanJudulId", auth, c.getSidang);
router.patch("/sidang/:pengajuanJudulId/start", auth, c.startSidang);
router.post("/sidang/:pengajuanJudulId/notulen", auth, c.submitNotulen);
router.post("/sidang/:pengajuanJudulId/penilaian", auth, c.submitPenilaian);
router.post("/sidang/:pengajuanJudulId/hasil-penilaian", auth, c.submitHasilPenilaian);
router.get("/sidang/:pengajuanJudulId/files/berita-acara", auth, c.getBeritaAcara);

module.exports = router;
