const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skPenelitian.controller");

router.get("/sekretariat/sk-penelitian", auth, c.listSkForSekretariat);
router.get("/dekan/sk-penelitian", auth, c.listSkForDekan);
router.post("/sk-penelitian/:outlineId/init", auth, c.initSkPenelitian);
router.get("/sk-penelitian/:outlineId", auth, c.getSkPenelitian);
router.post("/sk-penelitian/:outlineId/submit", auth, c.submitSkPenelitian);
router.post("/sk-penelitian/:outlineId/resubmit", auth, c.resubmitSkPenelitian);
router.patch("/sk-penelitian/:outlineId/files/:fileType/status", auth, c.reviewSkFile);
router.patch("/sk-penelitian/:outlineId/verify", auth, c.reviewSkPenelitian);
router.get("/sk-penelitian/:outlineId/files/:fileType", auth, c.getSkFile);

module.exports = router;
