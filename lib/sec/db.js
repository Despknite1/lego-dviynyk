// Storage: Postgres via DATABASE_URL (Neon/Supabase) or local SQLite file (sql.js, no native build) for development.
const fs = require('fs'), path = require('path');
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email_enc TEXT NOT NULL, email_idx TEXT NOT NULL UNIQUE, backup_email_enc TEXT, backup_email_idx TEXT, phone_enc TEXT, phone_idx TEXT, pw_hash TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS reset_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL, channel TEXT NOT NULL, expires BIGINT NOT NULL, used INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS reset_user ON reset_codes(user_id)`,
];
let impl = null;
async function init() {
  if (impl) return impl;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: true }, max: 5 });
    for (const s of SCHEMA) await pool.query(s);
    impl = { kind: 'postgres', q: async (sql, p = []) => (await pool.query(sql, p)).rows };
  } else {
    const initSqlJs = require('sql.js'); const SQL = await initSqlJs();
    const file = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'app.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    for (const s of SCHEMA) db.run(s);
    const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(db.export()), { mode: 0o600 }); fs.renameSync(tmp, file); };
    save();
    impl = { kind: 'sqlite', q: async (sql, p = []) => { const st = db.prepare(sql.replace(/\$\d+/g, '?')); st.bind(p); const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); if (!/^\s*select/i.test(sql)) save(); return rows; } };
  }
  return impl;
}
module.exports = { init };
