const db = require("../db");

function decodeSignatureToBuffer(signatureValue) {
  if (signatureValue === undefined || signatureValue === null) return null;

  const raw = String(signatureValue).trim();
  if (!raw) return null;

  const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) {
    try {
      return Buffer.from(dataUrlMatch[1], "base64");
    } catch (_) {
      return null;
    }
  }

  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 =
    /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      return Buffer.from(normalized, "base64");
    } catch (_) {
      return null;
    }
  }

  return null;
}

exports.getMySignature = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT signature_image FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
    );
    const signatureImage = rows[0]?.signature_image ?? null;
    return res.json({
      ok: true,
      data: { hasSignature: signatureImage !== null, signatureImage },
    });
  } catch (err) {
    next(err);
  }
};

exports.upsertMySignature = async (req, res, next) => {
  try {
    const signatureImage = req.body?.signatureImage;
    if (!signatureImage || !String(signatureImage).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "signatureImage is required" });
    }

    const buf = decodeSignatureToBuffer(signatureImage);
    if (!buf || buf.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "signatureImage is not a valid base64 image" });
    }

    await db.query(
      `UPDATE users SET signature_image = ? WHERE id = ?`,
      [String(signatureImage), req.user.id],
    );

    return res.json({ ok: true, data: { message: "Signature saved." } });
  } catch (err) {
    next(err);
  }
};

exports.deleteMySignature = async (req, res, next) => {
  try {
    await db.query(
      `UPDATE users SET signature_image = NULL WHERE id = ?`,
      [req.user.id],
    );
    return res.json({ ok: true, data: { message: "Signature deleted." } });
  } catch (err) {
    next(err);
  }
};
