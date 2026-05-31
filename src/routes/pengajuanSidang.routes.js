const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/pengajuanSidang.controller");

router.get("/sekretariat/pengajuan-sidang", auth, c.listForSekretariat);
router.post(
  "/pengajuan-sidang/:pengajuanJudulId/init",
  auth,
  c.initPengajuanSidang,
);
router.get("/pengajuan-sidang/:pengajuanJudulId", auth, c.getPengajuanSidang);
router.post("/pengajuan-sidang/:pengajuanJudulId/files", auth, c.uploadFiles);
router.post(
  "/pengajuan-sidang/:pengajuanJudulId/submit",
  auth,
  c.submitPengajuanSidang,
);
router.get(
  "/pengajuan-sidang/:pengajuanJudulId/files/:fileType",
  auth,
  c.getFile,
);
router.patch(
  "/pengajuan-sidang/:pengajuanJudulId/files/:fileType/status",
  auth,
  c.reviewFile,
);
router.patch(
  "/pengajuan-sidang/:pengajuanJudulId/verify",
  auth,
  c.finalizePengajuanSidang,
);

router.get("/kaprodi/pengajuan-sidang-kaprodi", auth, c.listKaprodiSubmissions);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/init",
  auth,
  c.initKaprodi,
);
router.get("/pengajuan-sidang-kaprodi/:pengajuanJudulId", auth, c.getKaprodi);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId",
  auth,
  c.updateKaprodi,
);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/submit",
  auth,
  c.submitKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/files/:fileType/status",
  auth,
  c.reviewFileKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/review",
  auth,
  c.reviewKaprodi,
);
router.patch(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/disposisi",
  auth,
  c.updateDisposisi,
);
router.post(
  "/pengajuan-sidang-kaprodi/:pengajuanJudulId/disposisi/submit",
  auth,
  c.submitDisposisi,
);

router.get("/sekretariat/disposisi-sidang", auth, c.listDisposisiForSekretariat);

module.exports = router;
