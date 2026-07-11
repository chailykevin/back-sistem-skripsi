const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/institutionPendingActions.controller");

router.get("/perpustakaan/pending-actions", auth, c.getPerpustakaanPendingActions);
router.get("/lppm/pending-actions", auth, c.getLppmPendingActions);

module.exports = router;
