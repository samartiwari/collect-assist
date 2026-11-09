import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('officer', 'manager', 'head')),
  branch_id     TEXT REFERENCES branches(id),
  lang          TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'hi')),
  cap           INTEGER NOT NULL DEFAULT 40
);

-- Which pincodes each officer covers. Drives auto-assignment.
CREATE TABLE IF NOT EXISTS officer_pincodes (
  officer_id TEXT NOT NULL REFERENCES users(id),
  pincode    TEXT NOT NULL,
  PRIMARY KEY (officer_id, pincode)
);

CREATE TABLE IF NOT EXISTS loans (
  id                TEXT PRIMARY KEY,
  borrower_name     TEXT NOT NULL,
  business_type     TEXT NOT NULL,
  phone             TEXT NOT NULL,
  address           TEXT NOT NULL,
  pincode           TEXT NOT NULL,
  lat               REAL,
  lng               REAL,
  branch_id         TEXT NOT NULL REFERENCES branches(id),
  outstanding       INTEGER NOT NULL CHECK (outstanding >= 0),
  emi               INTEGER NOT NULL CHECK (emi >= 0),
  dpd               INTEGER NOT NULL,
  last_payment_date TEXT,
  paid_last_3m      INTEGER,
  officer_id        TEXT REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cured')),
  pinned_by         TEXT REFERENCES users(id),
  pinned_reason     TEXT,
  pinned_at         TEXT,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS loans_officer ON loans(officer_id, status);
CREATE INDEX IF NOT EXISTS loans_branch ON loans(branch_id, status);

-- Latest score per loan. Reasons are stored as JSON so the list loads in one query.
CREATE TABLE IF NOT EXISTS scores (
  loan_id         TEXT PRIMARY KEY REFERENCES loans(id),
  model_version   TEXT NOT NULL,
  scored_at       TEXT NOT NULL,
  probability     REAL NOT NULL,
  priority        INTEGER NOT NULL,
  expected_loss   INTEGER NOT NULL,
  confidence      TEXT NOT NULL,
  confidence_note TEXT,
  reasons         TEXT NOT NULL
);

-- Every contact attempt (call or visit), including blocked ones. id is made on the phone.
CREATE TABLE IF NOT EXISTS attempts (
  id              TEXT PRIMARY KEY,
  loan_id         TEXT NOT NULL REFERENCES loans(id),
  officer_id      TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('call', 'visit')),
  outcome         TEXT CHECK (outcome IN ('paid', 'promise', 'not_reachable', 'dispute')),
  status          TEXT NOT NULL CHECK (status IN ('accepted', 'blocked')),
  amount          INTEGER,
  promise_date    TEXT,
  note            TEXT,
  lat             REAL,
  lng             REAL,
  accuracy_m      REAL,
  occurred_at     TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  created_offline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attempts_officer_time ON attempts(officer_id, occurred_at);
CREATE INDEX IF NOT EXISTS attempts_loan_time ON attempts(loan_id, occurred_at);

CREATE TABLE IF NOT EXISTS promises (
  id           TEXT PRIMARY KEY,
  loan_id      TEXT NOT NULL REFERENCES loans(id),
  officer_id   TEXT NOT NULL REFERENCES users(id),
  amount       INTEGER NOT NULL,
  promise_date TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  kept_at      TEXT,
  superseded   INTEGER NOT NULL DEFAULT 0,
  attempt_id   TEXT
);
CREATE INDEX IF NOT EXISTS promises_loan ON promises(loan_id);

CREATE TABLE IF NOT EXISTS templates (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  lang     TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('borrower', 'officer')),
  body     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  loan_id     TEXT NOT NULL REFERENCES loans(id),
  template_id TEXT NOT NULL REFERENCES templates(id),
  audience    TEXT NOT NULL,
  lang        TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent_mock', 'blocked')),
  reason      TEXT,
  created_at  TEXT NOT NULL,
  sent_by     TEXT NOT NULL REFERENCES users(id)
);

-- Month-start snapshots of the 1-30 DPD bucket with what happened next.
-- Feeds both the roll-rate dashboard and model training.
CREATE TABLE IF NOT EXISTS bucket_history (
  loan_id             TEXT NOT NULL,
  branch_id           TEXT NOT NULL REFERENCES branches(id),
  month               TEXT NOT NULL,
  dpd                 INTEGER NOT NULL,
  outstanding         INTEGER NOT NULL,
  emi                 INTEGER NOT NULL,
  paid_last_3m        INTEGER,
  last_payment_date   TEXT,
  broken_promises_90d INTEGER NOT NULL,
  open_promise_date   TEXT,
  rolled              INTEGER NOT NULL,
  PRIMARY KEY (loan_id, month)
);

CREATE TABLE IF NOT EXISTS models (
  version    TEXT PRIMARY KEY,
  trained_at TEXT NOT NULL,
  body       TEXT NOT NULL,
  backtest   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS imports (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  rows_total  INTEGER NOT NULL,
  rows_ok     INTEGER NOT NULL,
  rows_error  INTEGER NOT NULL,
  errors      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function isEmpty(db: DB): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
}
