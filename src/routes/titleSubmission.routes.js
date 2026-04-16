const router = require("express").Router();
const auth = require("../middlewares/auth");
const attachProgramStudi = require("../middlewares/attachProgramStudi");
const ensureOutlineSubmissionPeriodOpen = require("../middlewares/ensureOutlineSubmissionPeriodOpen");
const c = require("../controllers/titleSubmission.controller");
const kaprodi = require("../controllers/titleSubmissionKaprodi.controller");

router.post("/", auth, ensureOutlineSubmissionPeriodOpen, attachProgramStudi, c.createTitleSubmission);
router.get("/me", auth, c.listMine);
router.get("/latest", auth, c.getLatestMine);
router.patch("/:id/resubmit", auth, ensureOutlineSubmissionPeriodOpen, c.resubmit);
router.get("/", auth, kaprodi.listForKaprodi);
router.patch("/:id/review", auth, kaprodi.review);
router.get("/:id", auth, c.getById);

module.exports = router;
