const router = require("express").Router();
const db = require("../db");

router.get("/ping", async (req, res, next) => {
  try {
    const [rows] = await db.query("SELECT 1 AS ok");
    res.json({ ok: true, rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
