const router = require("express").Router();
const auth = require("../middlewares/auth");
const usersController = require("../controllers/users.controller");
const userSignatureController = require("../controllers/userSignature.controller");

router.get("/mahasiswa", auth, usersController.listMahasiswa);
router.get("/dosen", auth, usersController.listDosen);

router.get("/me/signature", auth, userSignatureController.getMySignature);
router.post("/me/signature", auth, userSignatureController.upsertMySignature);
router.delete("/me/signature", auth, userSignatureController.deleteMySignature);

module.exports = router;
