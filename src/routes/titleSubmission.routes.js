const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/titleSubmission.controller");

router.post("/", auth, c.createDraft);
router.get("/me", auth, c.listMine);
router.patch("/:id/submit", auth, c.submit);

module.exports = router;