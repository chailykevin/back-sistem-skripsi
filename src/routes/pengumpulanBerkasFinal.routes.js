const router = require("express").Router();
const c = require("../controllers/pengumpulanBerkasFinal.controller");
const auth = require("../middlewares/auth");

router.get("/lecturer/pengumpulan-berkas-final", auth, c.listForLecturer);
router.get("/perpustakaan/pengumpulan-berkas-final", auth, c.listForPerpustakaan);
router.get("/lppm/pengumpulan-berkas-final", auth, c.listForLppm);
router.get("/sekretariat-prodi/pengumpulan-berkas-final", auth, c.listForSekretariatProdi);
router.post("/pengumpulan-berkas-final/:pengajuanJudulId/init", auth, c.initPengumpulan);
router.post("/pengumpulan-berkas-final/:pengajuanJudulId/submit", auth, c.submitPengumpulan);
router.post("/pengumpulan-berkas-final/:pengajuanJudulId/confirm", auth, c.confirmPengumpulan);
router.post("/pengumpulan-berkas-final/:pengajuanJudulId/sign", auth, c.signPengumpulan);
router.get("/pengumpulan-berkas-final/:pengajuanJudulId", auth, c.getPengumpulan);
router.get("/pengumpulan-berkas-final/:pengajuanJudulId/files/:fileType", auth, c.getFile);

module.exports = router;
