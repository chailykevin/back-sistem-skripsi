const mysql = require("mysql2/promise");

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 3,
    maxIdle: 3,
    idleTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    queueLimit: 0,
  });
}

// Vercel keeps `global` alive across invocations on the same warm serverless
// instance, but re-imports this module fresh on every cold start. Without
// caching on `global`, each cold start created a brand-new pool that was
// never closed, so old pools' connections piled up against Aiven's
// max-connections cap over time.
if (!global.__mysqlPool) {
  global.__mysqlPool = createPool();
}

module.exports = global.__mysqlPool;
