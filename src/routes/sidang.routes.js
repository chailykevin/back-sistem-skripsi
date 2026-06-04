const router = require("express").Router();
const c = require("../controllers/sidang.controller");
const auth = require("../middlewares/auth");

router.get("/sekretariat/sidang", auth, c.getSekretariatSidang);
router.get("/lecturer/sidang", auth, c.getLecturerSidang);
router.get("/sidang/:pengajuanJudulId", auth, c.getSidang);
router.patch("/sidang/:pengajuanJudulId/start", auth, c.startSidang);
router.post("/sidang/:pengajuanJudulId/notulen", auth, c.submitNotulen);
router.post("/sidang/:pengajuanJudulId/penilaian", auth, c.submitPenilaian);
router.post("/sidang/:pengajuanJudulId/hasil-penilaian", auth, c.submitHasilPenilaian);
router.get("/sidang/:pengajuanJudulId/files/berita-acara", auth, c.getBeritaAcara);
router.get("/sidang/:pengajuanJudulId/files/hasil-penilaian", auth, c.getHasilPenilaianFile);
router.get("/sidang/:pengajuanJudulId/files/penilaian/:role", auth, c.getPenilaianFile);
router.get("/sidang/:pengajuanJudulId/files/notulen/:role", auth, c.getNotulenFile);

module.exports = router;
