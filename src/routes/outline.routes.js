const router = require("express").Router();
const auth = require("../middlewares/auth");
const outlineController = require("../controllers/outline.controller");

// mahasiswa upload outline
router.post("/", auth, outlineController.create);

module.exports = router;
