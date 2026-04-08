const jwt = require("jsonwebtoken");

function deriveLegacyUserType(roles = []) {
  if (roles.includes("STUDENT")) return "STUDENT";
  if (roles.includes("LECTURER") || roles.includes("KAPRODI")) return "LECTURER";
  return roles[0] ?? null;
}

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
    const roles = Array.isArray(payload.roles) ? payload.roles : [];

    req.user = {
      id: payload.sub,
      roles,
      userType: payload.userType ?? deriveLegacyUserType(roles),
      hasRole: (...wantedRoles) => {
        const want = wantedRoles.flat().filter(Boolean);
        return want.some((role) => roles.includes(role));
      },
    };

    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized",
    });
  }
};
