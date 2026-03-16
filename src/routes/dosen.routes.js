const router = require("express").Router();
const auth = require("../middlewares/auth");
const dosenController = require("../controllers/dosen.controller");

router.get("/", auth, dosenController.list);

module.exports = router;
