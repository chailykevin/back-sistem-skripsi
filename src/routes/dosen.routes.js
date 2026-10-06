const router = require("express").Router();
const auth = require("../middlewares/auth");
const attachProgramStudi = require("../middlewares/attachProgramStudi");
const dosenController = require("../controllers/dosen.controller");
const dosenBimbingProdiController = require("../controllers/dosenBimbingProdi.controller");

router.get(
  "/pembimbing-eligible",
  auth,
  attachProgramStudi,
  dosenBimbingProdiController.listEligible,
);
router.get("/", auth, dosenController.list);

module.exports = router;
