const router = require("express").Router();
const auth = require("../middlewares/auth");
const usersController = require("../controllers/users.controller");

router.get("/mahasiswa", auth, usersController.listMahasiswa);
router.get("/dosen", auth, usersController.listDosen);

module.exports = router;
