const router = require("express").Router();
const auth = require("../middlewares/auth");
const attachProgramStudi = require("../middlewares/attachProgramStudi");
const dosenController = require("../controllers/dosen.controller");
const dosenBimbingProdiController = require("../controllers/dosenBimbingProdi.controller");
const dosenUjiSidangSkripsiProdiController = require("../controllers/dosenUjiSidangSkripsiProdi.controller");

router.get(
  "/pembimbing-eligible",
  auth,
  attachProgramStudi,
  dosenBimbingProdiController.listEligible,
);
router.get(
  "/penguji-sidang-skripsi-eligible",
  auth,
  dosenUjiSidangSkripsiProdiController.listEligible,
);
router.get("/", auth, dosenController.list);

module.exports = router;
