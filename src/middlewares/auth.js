const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const token = auth.slice("Bearer ".length);

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: payload.sub,
      userType: payload.userType,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized",
    });
  }
};