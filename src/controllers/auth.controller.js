const bcrypt = require("bcrypt");
const db = require("../db"); // mysql2 pool

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Username and password are required",
      });
    }

    const [users] = await db.query(
      `SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password",
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password",
      });
    }

    // Ambil profil sesuai tipe user
    let profile = null;

    if (user.user_type === "STUDENT") {
      const [rows] = await db.query(
        `SELECT npm, nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
        [user.npm]
      );
      profile = rows[0] || null;
    }

    if (user.user_type === "LECTURER") {
      const [rows] = await db.query(
        `SELECT nidn, nama FROM dosen WHERE nidn = ? LIMIT 1`,
        [user.nidn]
      );
      profile = rows[0] || null;
    }

    return res.json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        userType: user.user_type,
        profile,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res) => {
  // sementara dummy (nanti pakai auth middleware / token)
  res.json({
    ok: true,
    message: "Auth me endpoint (not protected yet)",
  });
};
