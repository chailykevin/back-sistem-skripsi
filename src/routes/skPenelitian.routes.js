const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skPenelitian.controller");

router.get("/sekretariat/sk-penelitian", auth, c.listSkForSekretariat);
router.post("/sk-penelitian/:pengajuanJudulId/init", auth, c.initSkPenelitian);
router.get("/sk-penelitian/:pengajuanJudulId", auth, c.getSkPenelitian);
router.post("/sk-penelitian/:pengajuanJudulId/submit", auth, c.submitSkPenelitian);
router.patch("/sk-penelitian/:pengajuanJudulId/verify", auth, c.verifySkPenelitian);
router.get("/sk-penelitian/:pengajuanJudulId/files/:fileType", auth, c.getSkFile);
router.patch("/sk-penelitian/:pengajuanJudulId/files/:fileType/status", auth, c.verifySkFile);

module.exports = router;
