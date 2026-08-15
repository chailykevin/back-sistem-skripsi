const db = require("../db");

async function getPengumpulanBerkasFinaNotificationByRole(db, recipientRole) {
  const [data] = await db.query(
    `SELECT COUNT(*) AS c
       FROM pengumpulan_berkas_final_confirmations c
       JOIN pengumpulan_berkas_final p ON p.id = c.pengumpulan_id
       WHERE c.recipient_role = ? AND c.confirmed_at IS NULL AND p.status != 'DRAFT'`,
    [recipientRole],
  );

  const pengumpulanBerkasFinal = Number(data[0]?.c ?? 0);

  return {
    pengumpulanBerkasFinal,
    total: pengumpulanBerkasFinal,
  };
}

async function getPendingActionsByRole(
  roleCode,
  recipientRole,
  req,
  res,
  next,
) {
  try {
    if (!req.user.hasRole(roleCode)) {
      return res.status(403).json({
        ok: false,
        message: `Only ${roleCode} can access this endpoint`,
      });
    }

    const data = await getPengumpulanBerkasFinaNotificationByRole(
      db,
      recipientRole,
    );

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPendingActionsByRole };
