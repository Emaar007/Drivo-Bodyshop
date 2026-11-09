-- Built-in login (used instead of Cloudflare Access, which needs a card on file).
CREATE TABLE IF NOT EXISTS users (
  email          TEXT PRIMARY KEY,          -- lower-case
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,             -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  is_admin       INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  last_login_at  TEXT,
  must_change_pw INTEGER NOT NULL DEFAULT 0 -- set when an admin resets the password
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key        TEXT PRIMARY KEY,              -- email or ip
  count      INTEGER NOT NULL,
  first_at   TEXT NOT NULL
);
