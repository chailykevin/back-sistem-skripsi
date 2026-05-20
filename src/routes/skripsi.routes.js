"use strict";
const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skripsi.controller");

router.get("/skripsi/me",          auth, c.getMySkripsi);
router.get("/lecturer/skripsi",    auth, c.getLecturerSkripsi);
router.get("/kaprodi/skripsi",     auth, c.getKaprodiSkripsi);
router.get("/sekretariat/skripsi", auth, c.getSekretariatSkripsi);

module.exports = router;
