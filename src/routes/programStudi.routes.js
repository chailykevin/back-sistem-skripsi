const router = require("express").Router();
const auth = require("../middlewares/auth");
const programStudiController = require("../controllers/programStudi.controller");

router.post(
  "/kaprodi",
  auth,
  programStudiController.getKaprodiNameByProgramStudi
);

module.exports = router;
