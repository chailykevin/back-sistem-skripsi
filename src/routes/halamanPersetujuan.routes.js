const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/halamanPersetujuan.controller");

router.post("/halaman-persetujuan/:pengajuanDisposisiPembimbingId/init", auth, c.initHalamanPersetujuan);
router.get("/halaman-persetujuan/:pengajuanDisposisiPembimbingId", auth, c.getHalamanPersetujuan);
router.post("/halaman-persetujuan/:pengajuanDisposisiPembimbingId/sign", auth, c.signHalamanPersetujuan);
router.get("/halaman-persetujuan/:pengajuanDisposisiPembimbingId/file", auth, c.getHalamanPersetujuanFile);

module.exports = router;
