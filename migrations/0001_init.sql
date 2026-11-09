-- Drivo bodyshop dashboard: D1 schema.
-- Snapshots hold what TSD looked like at each push; tasks/notes are the team's own work.

-- Raw payload from the TSD push script, one row per push (kept for audit / replay).
CREATE TABLE IF NOT EXISTS ingests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at    TEXT NOT NULL,            -- ISO UTC, from the push script
  received_at   TEXT NOT NULL,            -- ISO UTC, Worker clock
  source        TEXT NOT NULL,            -- 'tsd' | 'sample'
  rental_count  INTEGER NOT NULL,
  duration_sec  REAL,
  payload       TEXT NOT NULL             -- JSON (normalised rentals + lookups)
);

-- Daily snapshot: counts and amounts per New York date (one row per date, the latest push wins).
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_date       TEXT PRIMARY KEY,   -- YYYY-MM-DD America/New_York
  ingest_id           INTEGER NOT NULL REFERENCES ingests(id),
  created_at          TEXT NOT NULL,
  overdue_count       INTEGER NOT NULL,
  overdue_customer    INTEGER NOT NULL,
  due_soon_count      INTEGER NOT NULL,
  open_ended_count    INTEGER NOT NULL,
  out_count           INTEGER NOT NULL,
  amount_at_risk      REAL NOT NULL,      -- amount due on overdue rentals
  outstanding_total   REAL NOT NULL,      -- all amount due > 0
  billed_total        REAL NOT NULL,
  collected_total     REAL NOT NULL,
  overdue_ra_numbers  TEXT NOT NULL,      -- JSON array, to diff "new overdue" day over day
  out_ra_numbers      TEXT NOT NULL       -- JSON array, to diff "returned" day over day
);

-- Tasks: one per rental per reason per day it is generated. A task completed yesterday
-- that is still overdue today comes back as a new task (new task_date).
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_date     TEXT NOT NULL,            -- YYYY-MM-DD America/New_York
  ra_number     TEXT NOT NULL,
  reason        TEXT NOT NULL,            -- overdue_customer | overdue_company | due_soon | open_ended | data_fix | balance
  priority      INTEGER NOT NULL,         -- 1 = highest
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | completed | snoozed
  assigned_to   TEXT,
  snoozed_until TEXT,                     -- YYYY-MM-DD
  outcome       TEXT,                     -- extended | returned | payment_promised | paid | unreachable | other
  outcome_date  TEXT,                     -- e.g. extended-to date / payment promised date
  outcome_note  TEXT,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  started_by    TEXT,
  completed_at  TEXT,
  completed_by  TEXT,
  updated_at    TEXT NOT NULL,
  UNIQUE (task_date, ra_number, reason)
);
CREATE INDEX IF NOT EXISTS tasks_date_status ON tasks (task_date, status);
CREATE INDEX IF NOT EXISTS tasks_ra ON tasks (ra_number);

-- Free-form notes the team adds to a rental (TSD notes are read-only and come with the snapshot).
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ra_number   TEXT NOT NULL,
  task_id     INTEGER REFERENCES tasks(id),
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_ra ON notes (ra_number);

-- Body shop contact overrides / additions (TSD's Cco list comes with the snapshot; this table
-- lets admins correct a phone or add a contact person without touching TSD).
CREATE TABLE IF NOT EXISTS bodyshop_contacts (
  key          TEXT PRIMARY KEY,          -- normalised body shop name
  display_name TEXT NOT NULL,
  contact      TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL
);

-- Name aliases (e.g. STATEFARM -> State Farm) editable in Settings, merged with config/*.ts.
CREATE TABLE IF NOT EXISTS aliases (
  alias       TEXT PRIMARY KEY,           -- normalised raw name
  canonical   TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- bodyshop | insurer
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

-- Rule overrides editable in Settings (DUE_SOON_DAYS etc.). Code defaults apply when absent.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

-- Audit of task actions for the Shift view / Task activity report.
CREATE TABLE IF NOT EXISTS task_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  ra_number   TEXT NOT NULL,
  action      TEXT NOT NULL,              -- start | complete | snooze | reopen | assign | note
  detail      TEXT,                       -- JSON
  at          TEXT NOT NULL,
  by          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_at ON task_events (at);
