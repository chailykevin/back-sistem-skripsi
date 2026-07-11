const db = require("../db");

async function getPendingActionsForRecipientRole(roleCode, recipientRole, req, res, next) {
  try {
    if (!req.user.hasRole(roleCode)) {
      return res
        .status(403)
        .json({ ok: false, message: `Only ${roleCode} can access this endpoint` });
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS c
       FROM pengumpulan_berkas_final_confirmations c
       JOIN pengumpulan_berkas_final p ON p.id = c.pengumpulan_id
       WHERE c.recipient_role = ? AND c.confirmed_at IS NULL AND p.status != 'DRAFT'`,
      [recipientRole],
    );

    const pengumpulanBerkasFinal = Number(rows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        pengumpulanBerkasFinal,
        total: pengumpulanBerkasFinal,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /perpustakaan/pending-actions
exports.getPerpustakaanPendingActions = (req, res, next) =>
  getPendingActionsForRecipientRole("PERPUSTAKAAN_STAFF", "PERPUSTAKAAN", req, res, next);

// GET /lppm/pending-actions
exports.getLppmPendingActions = (req, res, next) =>
  getPendingActionsForRecipientRole("LPPM", "LPPM", req, res, next);
