const router = require("express").Router();
const auth = require("../middlewares/auth");
const controller = require("../controllers/outlineSubmissionPeriod.controller");

router.get("/", auth, controller.get);
router.put("/", auth, controller.upsert);

module.exports = router;
