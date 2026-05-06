const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skPenelitian.controller");

router.get("/sekretariat/sk-penelitian", auth, c.listSkForSekretariat);
router.post("/sk-penelitian/:pengajuanJudulId/init", auth, c.initSkPenelitian);
router.get("/sk-penelitian/:pengajuanJudulId", auth, c.getSkPenelitian);
router.post("/sk-penelitian/:pengajuanJudulId/submit", auth, c.submitSkPenelitian);
router.post("/sk-penelitian/:pengajuanJudulId/resubmit", auth, c.resubmitSkPenelitian);
router.patch("/sk-penelitian/:pengajuanJudulId/verify", auth, c.reviewSkPenelitian);
router.get("/sk-penelitian/:pengajuanJudulId/files/:fileType", auth, c.getSkFile);

module.exports = router;
