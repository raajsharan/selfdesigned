-- Audit trail for edits made to discovered VM records from the VM asset editor.
CREATE TABLE IF NOT EXISTS vmware_asset_edits (
  id        BIGSERIAL PRIMARY KEY,
  vm_id     BIGINT NOT NULL,
  field     VARCHAR(64) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edited_by VARCHAR(255),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
