CREATE TABLE IF NOT EXISTS tenable_imports (
  id          SERIAL PRIMARY KEY,
  filename    VARCHAR(255),
  row_count   INT NOT NULL DEFAULT 0,
  imported_by VARCHAR(255),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS tenable_assets (
  id          BIGSERIAL PRIMARY KEY,
  import_id   INT NOT NULL REFERENCES tenable_imports(id) ON DELETE CASCADE,
  hostname    VARCHAR(255),
  ip_address  VARCHAR(64),
  mac_address VARCHAR(64),
  os          VARCHAR(255),
  critical    INT NOT NULL DEFAULT 0,
  high        INT NOT NULL DEFAULT 0,
  medium      INT NOT NULL DEFAULT 0,
  low         INT NOT NULL DEFAULT 0,
  last_seen   TIMESTAMPTZ,
  raw         JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tenable_assets_import ON tenable_assets (import_id);
