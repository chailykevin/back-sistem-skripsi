const router = require("express").Router();
const c = require("../controllers/sidang.controller");
const auth = require("../middlewares/auth");

router.get("/sekretariat/sidang", auth, c.getSekretariatSidang);
router.get("/lecturer/sidang", auth, c.getLecturerSidang);
router.get("/sidang/:pengajuanDisposisiPembimbingId", auth, c.getSidang);
router.patch("/sidang/:pengajuanDisposisiPembimbingId/start", auth, c.startSidang);
router.post("/sidang/:pengajuanDisposisiPembimbingId/notulen", auth, c.submitNotulen);
router.post("/sidang/:pengajuanDisposisiPembimbingId/penilaian", auth, c.submitPenilaian);
router.post("/sidang/:pengajuanDisposisiPembimbingId/hasil-penilaian", auth, c.submitHasilPenilaian);
router.get("/sidang/:pengajuanDisposisiPembimbingId/files/berita-acara", auth, c.getBeritaAcara);
router.get("/sidang/:pengajuanDisposisiPembimbingId/files/hasil-penilaian", auth, c.getHasilPenilaianFile);
router.get("/sidang/:pengajuanDisposisiPembimbingId/files/penilaian/:role", auth, c.getPenilaianFile);
router.get("/sidang/:pengajuanDisposisiPembimbingId/files/notulen/:role", auth, c.getNotulenFile);

module.exports = router;
