const router = require("express").Router();
const auth = require("../middlewares/auth");
const attachProgramStudi = require("../middlewares/attachProgramStudi");
const c = require("../controllers/pengajuanDisposisiPembimbing.controller");
const kaprodi = require("../controllers/pengajuanDisposisiPembimbingKaprodi.controller");

router.post("/", auth, attachProgramStudi, c.createPengajuanDisposisiPembimbing);
router.get("/me", auth, c.listMine);
router.get("/latest", auth, c.getLatestMine);
router.patch("/:id/resubmit", auth, c.resubmit);
router.get("/", auth, kaprodi.listForKaprodi);
router.patch("/:id/review", auth, kaprodi.review);
router.get("/:id/files/:fileType", auth, c.getFile);
router.get("/:id", auth, c.getById);

module.exports = router;
