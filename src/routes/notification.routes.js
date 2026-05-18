const router = require("express").Router();
const auth = require("../middlewares/auth");
const { list, markRead } = require("../controllers/notification.controller");

router.get("/", auth, list);
router.post("/:id/read", auth, markRead);

module.exports = router;
