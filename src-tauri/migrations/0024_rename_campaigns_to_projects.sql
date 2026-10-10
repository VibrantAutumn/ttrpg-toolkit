-- Campaigns are now called projects. SQLite rewrites the foreign keys, indexes
-- and triggers that mention the old names when a table or column is renamed.
ALTER TABLE campaigns RENAME TO projects;

ALTER TABLE folders           RENAME COLUMN campaign_id TO project_id;
ALTER TABLE items             RENAME COLUMN campaign_id TO project_id;
ALTER TABLE tags              RENAME COLUMN campaign_id TO project_id;
ALTER TABLE field_definitions RENAME COLUMN campaign_id TO project_id;
ALTER TABLE field_sets        RENAME COLUMN campaign_id TO project_id;

-- The per-device "which project is open" setting.
UPDATE app_settings SET key = 'current_project_id' WHERE key = 'current_campaign_id';
