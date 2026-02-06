const router = require("express").Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middlewares/auth");

router.post("/login", authController.login);
router.get("/me", auth, authController.me);

module.exports = router;
