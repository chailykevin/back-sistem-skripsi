const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/sekprodiPendingActions.controller");

router.get("/sekprodi/pending-actions", auth, c.getPendingActions);

module.exports = router;
