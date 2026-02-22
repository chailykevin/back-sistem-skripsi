const router = require("express").Router();
const auth = require("../middlewares/auth");
const outlineController = require("../controllers/outline.controller");

router.post("/", auth, outlineController.create);
router.get("/", auth, outlineController.listForKaprodi);
router.get("/latest", auth, outlineController.getLatestMine);
router.patch("/:id/review", auth, outlineController.reviewByKaprodi);
router.patch("/:id", auth, outlineController.resubmit);
router.get("/:id", auth, outlineController.getById);

module.exports = router;
