const router = require("express").Router();
const auth = require("../middlewares/auth");
const controller = require("../controllers/dummyIntegration.controller");

router.post("/seed-mahasiswa", auth, controller.seedMahasiswaDummy);
router.post("/seed-dosen", auth, controller.seedDosenDummy);
router.post("/test-email", auth, controller.testEmail);

module.exports = router;
