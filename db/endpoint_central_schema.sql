-- ManageEngine Endpoint Central: custom groups and their members, copied from EC in the background (see ecGroupService.js).
CREATE TABLE IF NOT EXISTS ec_custom_groups (
  group_id                BIGINT PRIMARY KEY,
  name                    VARCHAR(255) NOT NULL,
  group_type              VARCHAR(64),
  category                VARCHAR(64),
  domain                  VARCHAR(255),
  created_on              BIGINT,
  modified_on             BIGINT,
  members_synced_modified BIGINT,
  member_count            INT,
  members_synced_at       TIMESTAMPTZ,
  criteria                JSONB
);

CREATE TABLE IF NOT EXISTS ec_group_members (
  group_id    BIGINT NOT NULL REFERENCES ec_custom_groups(group_id) ON DELETE CASCADE,
  resource_id BIGINT NOT NULL,
  name        VARCHAR(255),
  domain      VARCHAR(255),
  os_platform VARCHAR(32),
  PRIMARY KEY (group_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_ec_group_members_resource ON ec_group_members (resource_id);
CREATE INDEX IF NOT EXISTS idx_ec_group_members_name ON ec_group_members (lower(name));
