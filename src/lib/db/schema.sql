CREATE TABLE IF NOT EXISTS processing_sessions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES processing_sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  encoding TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  warning_codes_text TEXT NOT NULL,
  missing_fields_text TEXT NOT NULL,
  invalid_lines_text TEXT NOT NULL,
  structured_text TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES processing_sessions(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES processing_sessions(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  rule_id TEXT,
  anomaly_type TEXT,
  confidence TEXT,
  severity TEXT,
  evidence_text TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_baselines (
  supplier_name TEXT PRIMARY KEY,
  canonical_cnpj TEXT,
  known_approvers_text TEXT NOT NULL,
  known_banks_text TEXT NOT NULL,
  historical_amounts_text TEXT NOT NULL,
  seen_document_numbers_text TEXT NOT NULL,
  document_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_session_id ON anomalies(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_entries_session_id ON audit_entries(session_id);
