-- Status v2 (append-only status_events) shipped and deployed; the old
-- single-row unit_status table has been orphaned since (STATUS.md milestone 6).
DROP TABLE IF EXISTS unit_status;
