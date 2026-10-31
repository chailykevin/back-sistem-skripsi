const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/kaprodiDashboard.controller");

router.get("/kaprodi/dashboard/pipeline", auth, c.getPipeline);
router.get("/kaprodi/dashboard/recap", auth, c.getRecap);

module.exports = router;
