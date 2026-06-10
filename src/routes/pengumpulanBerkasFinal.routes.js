const router = require("express").Router();
const c = require("../controllers/pengumpulanBerkasFinal.controller");
const auth = require("../middlewares/auth");

router.get("/lecturer/pengumpulan-berkas-final", auth, c.listForLecturer);
router.get("/perpustakaan/pengumpulan-berkas-final", auth, c.listForPerpustakaan);
router.get("/lppm/pengumpulan-berkas-final", auth, c.listForLppm);
router.get("/sekretariat-prodi/pengumpulan-berkas-final", auth, c.listForSekretariatProdi);
router.post("/pengumpulan-berkas-final/:skripsiId/init", auth, c.initPengumpulan);
router.post("/pengumpulan-berkas-final/:skripsiId/submit", auth, c.submitPengumpulan);
router.post("/pengumpulan-berkas-final/:skripsiId/confirm", auth, c.confirmPengumpulan);
router.post("/pengumpulan-berkas-final/:skripsiId/sign", auth, c.signPengumpulan);
router.get("/pengumpulan-berkas-final/:skripsiId", auth, c.getPengumpulan);
router.get("/pengumpulan-berkas-final/:skripsiId/files/:fileType", auth, c.getFile);

module.exports = router;
