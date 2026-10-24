CREATE TABLE IF NOT EXISTS proxmox_servers (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(128) NOT NULL UNIQUE,
  host                  VARCHAR(255) NOT NULL,
  port                  INT NOT NULL DEFAULT 8006,
  token_id              VARCHAR(255) NOT NULL,         -- user@realm!tokenname
  token_secret_encrypted TEXT NOT NULL,
  verify_ssl            BOOLEAN NOT NULL DEFAULT TRUE,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  last_discovery_at     TIMESTAMPTZ,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proxmox_vms (
  id             BIGSERIAL PRIMARY KEY,
  server_id      INT NOT NULL REFERENCES proxmox_servers(id) ON DELETE CASCADE,
  vmid           INT NOT NULL,
  type           VARCHAR(8) NOT NULL DEFAULT 'qemu',   -- qemu | lxc
  name           VARCHAR(255),
  node           VARCHAR(128),
  status         VARCHAR(32),
  ip_address     VARCHAR(64),
  mac_addresses  TEXT[] NOT NULL DEFAULT '{}',
  os_type        VARCHAR(64),
  cpu_count      INT,
  memory_mb      INT,
  disk_gb        NUMERIC(10,1),
  tags           TEXT,
  is_template    BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot_count INT NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, vmid, type)
);

CREATE TABLE IF NOT EXISTS proxmox_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  vm_id       BIGINT NOT NULL REFERENCES proxmox_vms(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ
);
