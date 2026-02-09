const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/titleSubmission.controller");
const kaprodi = require("../controllers/titleSubmissionKaprodi.controller");

router.post("/", auth, c.createDraft);
router.get("/me", auth, c.listMine);
router.get("/", auth, kaprodi.listForKaprodi);
router.patch("/:id/review", auth, kaprodi.review);
router.patch("/:id", auth, c.updateDraft);
router.patch("/:id/submit", auth, c.submit);

module.exports = router;