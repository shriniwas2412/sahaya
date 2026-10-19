-- Sahaya schema. Every synced table carries id, hlc, deleted, origin, created_by.
-- Unknown values stay NULL. JSON columns hold JSON text.

CREATE TABLE app_user (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  role TEXT CHECK (role IN ('caregiver','field_worker','admin')),
  name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, password_hash TEXT, created_at TEXT
);

CREATE TABLE consent (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  subject_type TEXT CHECK (subject_type IN ('farmer','elder')), subject_id TEXT NOT NULL,
  given_by TEXT CHECK (given_by IN ('self','guardian','facility')), guardian_name TEXT, guardian_relation TEXT,
  method TEXT CHECK (method IN ('paper_signed','verbal_recorded','digital')),
  scope_store INTEGER NOT NULL, scope_sync INTEGER NOT NULL, scope_audio_cloud INTEGER DEFAULT 0,
  scope_contact_share INTEGER DEFAULT 0, scope_research_aggregate INTEGER DEFAULT 0,
  language TEXT, recorded_at TEXT NOT NULL,
  evidence_ref TEXT,
  withdrawn_at TEXT
);

CREATE TABLE elder (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  display_name TEXT NOT NULL, age INTEGER, birth_decade INTEGER,
  gds_stage INTEGER CHECK (gds_stage BETWEEN 1 AND 7),
  language TEXT, dialect TEXT, preferences TEXT, triggers TEXT,
  energy_pattern TEXT, sundown_start TEXT, sundown_end TEXT,
  facility TEXT, caregiver_id TEXT REFERENCES app_user(id),
  family_contacts TEXT, ngo_helpline TEXT,
  persona_name TEXT DEFAULT 'Sahaya',
  source TEXT CHECK (source IN ('paper','spreadsheet','app')), source_ref TEXT, notes TEXT
);

CREATE TABLE medicine (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  elder_id TEXT NOT NULL REFERENCES elder(id), name TEXT NOT NULL, dose TEXT,
  times TEXT, instructions TEXT,
  escalate_after_min INTEGER DEFAULT 30, alert_user_id TEXT, active INTEGER DEFAULT 1
);

CREATE TABLE dose_event (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  medicine_id TEXT NOT NULL REFERENCES medicine(id), scheduled_at TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending','due','taken','snoozed','missed','escalated','skipped')),
  confirmed_at TEXT, confirmed_by TEXT, escalated_at TEXT,
  snoozed_until TEXT  -- addition to the shared schema: end of a snooze (state machine in web/src/core/doses.ts)
);

CREATE TABLE session (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  elder_id TEXT NOT NULL REFERENCES elder(id), mode TEXT CHECK (mode IN ('companion','memory_activity','paper')),
  started_at TEXT, ended_at TEXT, stage_at_session INTEGER, language TEXT,
  topics TEXT, feedback_mood INTEGER CHECK (feedback_mood BETWEEN 1 AND 5),
  feedback_keep TEXT, feedback_avoid TEXT, feedback_notes TEXT,
  source TEXT, source_ref TEXT
);

CREATE TABLE activity_score (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  session_id TEXT NOT NULL REFERENCES session(id), task TEXT, score REAL, max_score REAL
);

CREATE TABLE safety_event (
  id TEXT PRIMARY KEY, hlc TEXT NOT NULL, deleted INTEGER DEFAULT 0, origin TEXT, created_by TEXT,
  elder_id TEXT NOT NULL, session_id TEXT, at TEXT NOT NULL,
  trigger TEXT CHECK (trigger IN ('keyword','silence','agitation','manual','missed_dose')),
  matched TEXT, action TEXT, resolved_at TEXT, resolved_by TEXT
);

-- server-only
CREATE TABLE push_sub (id TEXT PRIMARY KEY, user_id TEXT, endpoint TEXT, keys TEXT, created_at TEXT);

-- Sync bookkeeping (addition to the shared schema; server-only).
-- Per-field LWW versions for each synced row, so a merge keeps the newer value per field.
CREATE TABLE sync_meta (
  tbl TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL,
  versions TEXT NOT NULL,          -- JSON {column: hlc}
  hlc TEXT NOT NULL,               -- max of versions, for ?since= pulls
  PRIMARY KEY (tbl, id)
);
CREATE INDEX sync_meta_owner_hlc ON sync_meta (owner, hlc);
CREATE INDEX dose_event_status ON dose_event (status, scheduled_at);
