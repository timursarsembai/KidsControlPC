-- Where an alert or an activity event came from.
--
-- The Firestore import will run at least twice: a rehearsal, and the real one
-- days later against data that has moved on. Between those runs the agents are
-- already reporting to this server, so anything the import deletes wholesale it
-- deletes for real — including alerts a parent has not read yet.
--
-- With the Firestore id recorded, a re-run replaces exactly what it imported
-- last time and leaves everything this server produced itself alone.

alter table alerts add column legacy_id text;
alter table activity_logs add column legacy_id text;

create unique index alerts_legacy_key on alerts (owner_id, legacy_id)
  where legacy_id is not null;
create unique index activity_logs_legacy_key on activity_logs (device_id, legacy_id)
  where legacy_id is not null;
