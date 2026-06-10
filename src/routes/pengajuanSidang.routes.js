const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/pengajuanSidang.controller");

router.get("/sekretariat/pengajuan-sidang", auth, c.listForSekretariat);
router.post(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/init",
  auth,
  c.initPengajuanSidang,
);
router.get("/pengajuan-sidang/:pengajuanDisposisiPembimbingId", auth, c.getPengajuanSidang);
router.post("/pengajuan-sidang/:pengajuanDisposisiPembimbingId/files", auth, c.uploadFiles);
router.post(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/submit",
  auth,
  c.submitPengajuanSidang,
);
router.get(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/files/:fileType",
  auth,
  c.getFile,
);
router.patch(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/files/:fileType/status",
  auth,
  c.reviewFile,
);
router.patch(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/verify",
  auth,
  c.finalizePengajuanSidang,
);
router.patch(
  "/pengajuan-sidang/:pengajuanDisposisiPembimbingId/generate-surat-undangan",
  auth,
  c.generateSuratUndangan,
);

router.get("/kaprodi/pengajuan-sidang-kaprodi", auth, c.listKaprodiSubmissions);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/init",
  auth,
  c.initKaprodi,
);
router.get("/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId", auth, c.getKaprodi);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId",
  auth,
  c.updateKaprodi,
);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/submit",
  auth,
  c.submitKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/files/:fileType/status",
  auth,
  c.reviewFileKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/review",
  auth,
  c.reviewKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/disposisi",
  auth,
  c.updateDisposisi,
);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanDisposisiPembimbingId/disposisi/submit",
  auth,
  c.submitDisposisi,
);

router.get("/sekretariat/disposisi-sidang", auth, c.listDisposisiForSekretariat);

module.exports = router;
