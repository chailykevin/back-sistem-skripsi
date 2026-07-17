const router = require("express").Router();
const auth = require("../middlewares/auth");
const usersController = require("../controllers/users.controller");
const userSignatureController = require("../controllers/userSignature.controller");
const mahasiswaEmailController = require("../controllers/mahasiswaEmail.controller");
const userPasswordController = require("../controllers/userPassword.controller");

router.get("/mahasiswa", auth, usersController.listMahasiswa);
router.get("/dosen", auth, usersController.listDosen);

router.get("/me/signature", auth, userSignatureController.getMySignature);
router.post("/me/signature", auth, userSignatureController.upsertMySignature);
router.delete("/me/signature", auth, userSignatureController.deleteMySignature);

router.get("/me/email-status", auth, mahasiswaEmailController.getMyEmailStatus);
router.post("/me/email", auth, mahasiswaEmailController.submitMyEmail);

router.post("/me/change-password", auth, userPasswordController.changeMyPassword);

module.exports = router;
