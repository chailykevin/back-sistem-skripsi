const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/pengajuanSidang.controller");

router.get("/sekretariat/pengajuan-sidang", auth, c.listForSekretariat);
router.post("/pengajuan-sidang/:pengajuanJudulId/init", auth, c.initPengajuanSidang);
router.get("/pengajuan-sidang/:pengajuanJudulId", auth, c.getPengajuanSidang);
router.post("/pengajuan-sidang/:pengajuanJudulId/files", auth, c.uploadFiles);
router.post("/pengajuan-sidang/:pengajuanJudulId/submit", auth, c.submitPengajuanSidang);
router.get("/pengajuan-sidang/:pengajuanJudulId/files/:fileType", auth, c.getFile);
router.patch("/pengajuan-sidang/:pengajuanJudulId/files/:fileType/status", auth, c.reviewFile);
router.patch("/pengajuan-sidang/:pengajuanJudulId/verify", auth, c.finalizePengajuanSidang);

module.exports = router;
