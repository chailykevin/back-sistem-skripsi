const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/sidangSubmissionPeriod.controller");

router.get("/", auth, c.list);
router.post("/", auth, c.create);
router.get("/:id", auth, c.getById);
router.patch("/:id", auth, c.update);
router.delete("/:id", auth, c.remove);

module.exports = router;
