const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/lecturerPendingActions.controller");

router.get("/lecturer/pending-actions", auth, c.getPendingActions);

module.exports = router;
