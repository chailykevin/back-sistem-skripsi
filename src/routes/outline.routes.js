const router = require("express").Router();
const auth = require("../middlewares/auth");
const outlineController = require("../controllers/outline.controller");

router.post("/", auth, outlineController.create);
router.get("/me", auth, outlineController.listMine);

module.exports = router;
