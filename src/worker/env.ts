export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  INGEST_TOKEN?: string; // secret shared with scripts/tsd/push_bodyshop.py
  SESSION_SECRET?: string; // secret: signs the login cookie
  ADMIN_EMAILS?: string; // comma-separated extra admins (users flagged admin in the users table are admins too)
  DUE_SOON_DAYS?: string;
  TIMEZONE?: string;
  USE_SAMPLE_DATA?: string;
  DEV?: string; // "true" in .dev.vars: skip the login locally
}
