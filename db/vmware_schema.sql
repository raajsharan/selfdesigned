CREATE TABLE IF NOT EXISTS vmware_servers (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(128) NOT NULL UNIQUE,
  host               VARCHAR(255) NOT NULL,
  username           VARCHAR(255) NOT NULL,
  password_encrypted TEXT NOT NULL,
  verify_ssl         BOOLEAN NOT NULL DEFAULT TRUE,
  is_standalone_esxi BOOLEAN NOT NULL DEFAULT FALSE,   -- unmanaged ESXi (no vCenter)
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  last_discovery_at  TIMESTAMPTZ,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vmware_vms (
  id             BIGSERIAL PRIMARY KEY,
  server_id      INT NOT NULL REFERENCES vmware_servers(id) ON DELETE CASCADE,
  moid           VARCHAR(64) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  power_state    VARCHAR(32),
  ip_address     VARCHAR(64),
  mac_addresses  TEXT[] NOT NULL DEFAULT '{}',
  guest_os       VARCHAR(255),
  cpu_count      INT,
  memory_mb      INT,
  host_name      VARCHAR(255),
  cluster        VARCHAR(128),
  datacenter     VARCHAR(128),
  folder         VARCHAR(255),
  tools_status   VARCHAR(64),
  snapshot_count INT NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, moid)
);
CREATE INDEX IF NOT EXISTS idx_vmware_vms_name ON vmware_vms (lower(name));

CREATE TABLE IF NOT EXISTS vmware_hosts (
  id         BIGSERIAL PRIMARY KEY,
  server_id  INT NOT NULL REFERENCES vmware_servers(id) ON DELETE CASCADE,
  moid       VARCHAR(64) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  cluster    VARCHAR(128),
  datacenter VARCHAR(128),
  state      VARCHAR(32),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, moid)
);

CREATE TABLE IF NOT EXISTS vmware_snapshots (
  id         BIGSERIAL PRIMARY KEY,
  vm_id      BIGINT NOT NULL REFERENCES vmware_vms(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ,
  size_mb    BIGINT
);
