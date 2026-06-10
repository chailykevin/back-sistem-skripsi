const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skPenelitian.controller");

router.get("/sekretariat/sk-penelitian", auth, c.listSkForSekretariat);
router.post("/sk-penelitian/:pengajuanDisposisiPembimbingId/init", auth, c.initSkPenelitian);
router.get("/sk-penelitian/:pengajuanDisposisiPembimbingId", auth, c.getSkPenelitian);
router.post("/sk-penelitian/:pengajuanDisposisiPembimbingId/submit", auth, c.submitSkPenelitian);
router.post("/sk-penelitian/:pengajuanDisposisiPembimbingId/resubmit", auth, c.resubmitSkPenelitian);
router.patch("/sk-penelitian/:pengajuanDisposisiPembimbingId/files/:fileType/status", auth, c.reviewSkFile);
router.patch("/sk-penelitian/:pengajuanDisposisiPembimbingId/verify", auth, c.reviewSkPenelitian);
router.get("/sk-penelitian/:pengajuanDisposisiPembimbingId/files/:fileType", auth, c.getSkFile);

module.exports = router;
