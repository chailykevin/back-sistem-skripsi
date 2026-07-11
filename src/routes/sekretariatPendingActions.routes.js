const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/sekretariatPendingActions.controller");

router.get("/sekretariat/pending-actions", auth, c.getPendingActions);

module.exports = router;
