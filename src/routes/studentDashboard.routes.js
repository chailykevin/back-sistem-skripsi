const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/studentDashboard.controller");

router.get("/student/dashboard", auth, c.getDashboard);

module.exports = router;
