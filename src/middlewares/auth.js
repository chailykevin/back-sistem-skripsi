const jwt = require("jsonwebtoken");
const { getSessionState } = require("../services/authSession.service");

function deriveLegacyUserType(roles = []) {
  if (roles.includes("STUDENT")) return "STUDENT";
  if (roles.includes("LECTURER") || roles.includes("KAPRODI")) return "LECTURER";
  return roles[0] ?? null;
}

const unauthorized = (res, message = "Unauthorized") =>
  res.status(401).json({ ok: false, message });

module.exports = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return unauthorized(res);

  let payload;
  try {
    payload = jwt.verify(auth.slice("Bearer ".length), process.env.JWT_SECRET);
  } catch (err) {
    return unauthorized(res);
  }

  let session;
  try {
    session = await getSessionState(payload.sub);
  } catch (err) {
    return next(err);
  }
  if (!session || !session.isActive) return unauthorized(res);
  // Tokens issued before the last password reset/change are no longer valid.
  if (
    session.passwordChangedUnix != null &&
    Number(payload.iat) < session.passwordChangedUnix
  ) {
    return unauthorized(
      res,
      "Sesi Anda berakhir karena kata sandi telah diubah. Silakan login kembali.",
    );
  }

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
};
