const router = require("express").Router();
const auth = require("../middlewares/auth");
const controller = require("../controllers/dosenBimbingProdi.controller");

router.get("/", auth, controller.listAll);
router.get(
  "/program-studi/:programStudiId",
  auth,
  controller.listByProgramStudi,
);
router.post("/program-studi/:programStudiId", auth, controller.add);
router.patch("/program-studi/:programStudiId/:id", auth, controller.update);
router.delete("/program-studi/:programStudiId/:id", auth, controller.remove);

router.post("/", auth, controller.add);
router.patch("/:id", auth, controller.update);
router.delete("/:id", auth, controller.remove);
module.exports = router;
