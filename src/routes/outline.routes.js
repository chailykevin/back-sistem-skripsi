const router = require("express").Router();
const auth = require("../middlewares/auth");
const outlineController = require("../controllers/outline.controller");

router.post("/", auth, outlineController.create);
router.get("/me", auth, outlineController.listMine);
router.get("/", auth, outlineController.listForKaprodi);
router.patch("/:id/review", auth, outlineController.reviewByKaprodi);
router.get("/:id", auth, outlineController.getById);

module.exports = router;
