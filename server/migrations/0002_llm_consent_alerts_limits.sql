-- Consent for remote models, one alert per missed dose, and auth rate limits.

-- Consent to send conversation text to a remote model (Groq / OpenRouter). Default off.
ALTER TABLE consent ADD COLUMN scope_llm_cloud INTEGER DEFAULT 0;

-- Server-only: one row per missed-dose alert, so each dose alerts the caregiver at most once.
CREATE TABLE dose_alert (dose_id TEXT PRIMARY KEY, owner TEXT NOT NULL, at TEXT NOT NULL);

-- Server-only: login/register attempts for rate limiting. Keys are hashed; no raw IPs stored.
CREATE TABLE auth_attempt (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX auth_attempt_key_at ON auth_attempt (key, at);
