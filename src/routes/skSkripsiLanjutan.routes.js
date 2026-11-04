const router = require("express").Router();
const c = require("../controllers/skSkripsiLanjutan.controller");
const auth = require("../middlewares/auth");

router.get("/kaprodi/sk-skripsi-lanjutan", auth, c.listForKaprodi);
router.get("/sekretariat/sk-skripsi-lanjutan", auth, c.listForSekretariat);
router.get("/sk-skripsi-lanjutan/:skripsiId", auth, c.getDetail);
router.post("/sk-skripsi-lanjutan/:skripsiId/forward", auth, c.forward);
router.post("/sk-skripsi-lanjutan/:skripsiId/issue", auth, c.issue);
router.get("/sk-skripsi-lanjutan/:skripsiId/file", auth, c.getFile);

module.exports = router;
