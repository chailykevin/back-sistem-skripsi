const router = require("express").Router();
const auth = require("../middlewares/auth");
const controller = require("../controllers/dummyIntegration.controller");

// SIMIKO sync deactivates accounts missing from the source, so only admins may trigger it.
function requireAdmin(req, res, next) {
  if (!req.user?.hasRole("ADMIN")) {
    return res
      .status(403)
      .json({ ok: false, message: "Only admin can run SIMIKO synchronization" });
  }
  next();
}

router.post("/seed-mahasiswa", auth, requireAdmin, controller.seedMahasiswaDummy);
router.post("/seed-dosen", auth, requireAdmin, controller.seedDosenDummy);
router.post("/seed-staf", auth, requireAdmin, controller.seedStafDummy);
router.post("/test-email", auth, requireAdmin, controller.testEmail);

module.exports = router;
