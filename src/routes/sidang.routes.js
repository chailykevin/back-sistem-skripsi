const router = require("express").Router();
const c = require("../controllers/sidang.controller");
const auth = require("../middlewares/auth");

router.get("/sekretariat/sidang", auth, c.getSekretariatSidang);
router.get("/lecturer/sidang", auth, c.getLecturerSidang);
router.get("/sidang/:skripsiId", auth, c.getSidang);
router.patch("/sidang/:skripsiId/start", auth, c.startSidang);
router.post("/sidang/:skripsiId/notulen", auth, c.submitNotulen);
router.post("/sidang/:skripsiId/penilaian", auth, c.submitPenilaian);
router.post("/sidang/:skripsiId/hasil-penilaian", auth, c.submitHasilPenilaian);
router.get("/sidang/:skripsiId/files/berita-acara", auth, c.getBeritaAcara);
router.get("/sidang/:skripsiId/files/hasil-penilaian", auth, c.getHasilPenilaianFile);
router.get("/sidang/:skripsiId/files/penilaian/:role", auth, c.getPenilaianFile);
router.get("/sidang/:skripsiId/files/notulen/:role", auth, c.getNotulenFile);

module.exports = router;
