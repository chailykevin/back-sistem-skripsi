const db = require("../db");

const SIMIKO_STAFF_SIGNATURE_ROLES = new Set([
  "KAPRODI",
  "SEKPRODI",
  "SEKRETARIAT_PRODI",
  "DEKAN",
]);

const SIMIKO_LECTURER_SIGNATURE_ROLES = new Set(["LECTURER", "PEMBIMBING"]);

function hasAnyRole(roles = [], wantedRoles) {
  return roles.some((role) => wantedRoles.has(role));
}

async function getSignatureProfile(userId, roles = []) {
  const [[user]] = await db.query(
    `SELECT nidn, staff_usr_id, signature_image
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId],
  );

  if (!user) return null;

  const usesStaffSimikoSource = hasAnyRole(
    roles,
    SIMIKO_STAFF_SIGNATURE_ROLES,
  );
  const usesLecturerSimikoSource = hasAnyRole(
    roles,
    SIMIKO_LECTURER_SIGNATURE_ROLES,
  );

  if (!usesStaffSimikoSource && !usesLecturerSimikoSource) {
    const signatureImage = user.signature_image ?? null;
    return {
      hasSignature: signatureImage !== null,
      signatureImage,
      source: "LOCAL",
      canManage: true,
      manageMessage: null,
    };
  }

  if (usesStaffSimikoSource) {
    const staffUserId = user.staff_usr_id ?? user.nidn;
    if (!staffUserId) {
      return {
        hasSignature: false,
        signatureImage: null,
        source: "SIMIKO_PENDING",
        canManage: false,
        manageMessage:
          "Tanda tangan akan dikelola melalui SIMIKO. Identitas SIMIKO akun ini belum tersedia.",
      };
    }
    const [[staff]] = await db.query(
      `SELECT d.dsnTtd
       FROM widya_miko.c_useradm u
       JOIN widya_miko.m_dosen d ON d.dsnNama = u.usrNama
       WHERE u.usrId = ?
       LIMIT 1`,
      [staffUserId],
    );
    const signatureImage = staff?.dsnTtd ?? null;
    return {
      hasSignature: signatureImage !== null,
      signatureImage,
      source: "SIMIKO",
      canManage: false,
      manageMessage: "Tanda tangan dikelola melalui SIMIKO.",
    };
  }

  if (user.nidn) {
    const [[dosen]] = await db.query(
      `SELECT dsnTtd
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [user.nidn],
    );
    const signatureImage = dosen?.dsnTtd ?? null;
    return {
      hasSignature: signatureImage !== null,
      signatureImage,
      source: "SIMIKO",
      canManage: false,
      manageMessage: "Tanda tangan dikelola melalui SIMIKO.",
    };
  }

  return {
    hasSignature: false,
    signatureImage: null,
    source: "SIMIKO_PENDING",
    canManage: false,
    manageMessage:
      "Tanda tangan akan dikelola melalui SIMIKO. Sumber preview untuk akun ini sedang disiapkan.",
  };
}

async function rejectLocalSignatureManagement(req, res) {
  const profile = await getSignatureProfile(req.user.id, req.user.roles);
  if (!profile) {
    res.status(404).json({ ok: false, message: "User not found" });
    return true;
  }
  if (!profile.canManage) {
    res.status(403).json({
      ok: false,
      message: profile.manageMessage,
      data: {
        source: profile.source,
        canManage: profile.canManage,
      },
    });
    return true;
  }
  return false;
}

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
    const profile = await getSignatureProfile(req.user.id, req.user.roles);
    if (!profile) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }
    return res.json({
      ok: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
};

exports.upsertMySignature = async (req, res, next) => {
  try {
    if (await rejectLocalSignatureManagement(req, res)) return;

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
    if (await rejectLocalSignatureManagement(req, res)) return;

    await db.query(
      `UPDATE users SET signature_image = NULL WHERE id = ?`,
      [req.user.id],
    );
    return res.json({ ok: true, data: { message: "Signature deleted." } });
  } catch (err) {
    next(err);
  }
};
