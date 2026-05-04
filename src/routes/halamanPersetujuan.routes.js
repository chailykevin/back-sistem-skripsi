const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/halamanPersetujuan.controller");

router.post("/halaman-persetujuan/:pengajuanJudulId/init", auth, c.initHalamanPersetujuan);
router.get("/halaman-persetujuan/:pengajuanJudulId", auth, c.getHalamanPersetujuan);
router.post("/halaman-persetujuan/:pengajuanJudulId/sign", auth, c.signHalamanPersetujuan);
router.get("/halaman-persetujuan/:pengajuanJudulId/file", auth, c.getHalamanPersetujuanFile);

module.exports = router;
