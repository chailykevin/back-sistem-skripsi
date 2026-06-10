const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/pengajuanSidang.controller");

router.get("/sekretariat/pengajuan-sidang", auth, c.listForSekretariat);
router.post("/pengajuan-sidang/:skripsiId/init", auth, c.initPengajuanSidang);
router.get("/pengajuan-sidang/:skripsiId", auth, c.getPengajuanSidang);
router.post("/pengajuan-sidang/:skripsiId/files", auth, c.uploadFiles);
router.post("/pengajuan-sidang/:skripsiId/submit", auth, c.submitPengajuanSidang);
router.get("/pengajuan-sidang/:skripsiId/files/:fileType", auth, c.getFile);
router.patch("/pengajuan-sidang/:skripsiId/files/:fileType/status", auth, c.reviewFile);
router.patch("/pengajuan-sidang/:skripsiId/verify", auth, c.finalizePengajuanSidang);
router.patch("/pengajuan-sidang/:skripsiId/generate-surat-undangan", auth, c.generateSuratUndangan);

router.get("/kaprodi/pengajuan-sidang-kaprodi", auth, c.listKaprodiSubmissions);
router.post("/pengajuan-sidang-kaprodi/:skripsiId/init", auth, c.initKaprodi);
router.get("/pengajuan-sidang-kaprodi/:skripsiId", auth, c.getKaprodi);
router.patch("/pengajuan-sidang-kaprodi/:skripsiId", auth, c.updateKaprodi);
router.post("/pengajuan-sidang-kaprodi/:skripsiId/submit", auth, c.submitKaprodi);
router.patch("/pengajuan-sidang-kaprodi/:skripsiId/files/:fileType/status", auth, c.reviewFileKaprodi);
router.patch("/pengajuan-sidang-kaprodi/:skripsiId/review", auth, c.reviewKaprodi);
router.patch("/pengajuan-sidang-kaprodi/:skripsiId/disposisi", auth, c.updateDisposisi);
router.post("/pengajuan-sidang-kaprodi/:skripsiId/disposisi/submit", auth, c.submitDisposisi);

router.get("/sekretariat/disposisi-sidang", auth, c.listDisposisiForSekretariat);

module.exports = router;
