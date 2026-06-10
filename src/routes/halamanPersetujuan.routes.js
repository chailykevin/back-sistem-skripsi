const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/halamanPersetujuan.controller");

router.post("/halaman-persetujuan/:outlineId/init", auth, c.initHalamanPersetujuan);
router.get("/halaman-persetujuan/:outlineId", auth, c.getHalamanPersetujuan);
router.post("/halaman-persetujuan/:outlineId/sign", auth, c.signHalamanPersetujuan);
router.get("/halaman-persetujuan/:outlineId/file", auth, c.getHalamanPersetujuanFile);

module.exports = router;
