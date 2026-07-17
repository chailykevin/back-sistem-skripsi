const router = require("express").Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middlewares/auth");

router.post("/login", authController.login);
router.get("/me", auth, authController.me);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.post("/verify-email", authController.verifyEmail);

module.exports = router;
