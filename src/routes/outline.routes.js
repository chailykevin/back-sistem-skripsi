const router = require("express").Router();
const auth = require("../middlewares/auth");
const attachProgramStudi = require("../middlewares/attachProgramStudi");
const outlineController = require("../controllers/outline.controller");

router.post("/", auth, attachProgramStudi, outlineController.create);
router.get("/", auth, outlineController.listForKaprodi);
router.get("/latest", auth, outlineController.getLatestMine);
router.get("/:id/review-history", auth, outlineController.getReviewHistory);
router.patch("/:id/review", auth, outlineController.reviewByKaprodi);
router.patch("/:id", auth, attachProgramStudi, outlineController.resubmit);
router.get("/:id", auth, outlineController.getById);

module.exports = router;
