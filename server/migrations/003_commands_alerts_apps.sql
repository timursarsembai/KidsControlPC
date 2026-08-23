-- Change notifications for the rest of what the panel watches: commands the
-- agent has to pick up, alerts it raises, and the list of installed programs.
--
-- notify_change is replaced rather than extended in place: alerts carry their
-- own owner and may have no device at all, and installed_apps has no `id`
-- column — its key is (device_id, app_id). The previous version assumed both.

create or replace function notify_change() returns trigger
language plpgsql
as $$
declare
  rec record;
  owner uuid;
  device uuid;
  row_id text;
begin
  rec := coalesce(new, old);

  if tg_table_name = 'devices' then
    owner := rec.owner_id;
    device := rec.id;
    row_id := rec.id::text;

  elsif tg_table_name = 'alerts' then
    -- An alert belongs to the account, not necessarily to a device: the
    -- device may have been deleted, which nulls the reference.
    owner := rec.owner_id;
    device := rec.device_id;
    row_id := rec.id::text;

  elsif tg_table_name = 'installed_apps' then
    device := rec.device_id;
    row_id := rec.app_id;
    select d.owner_id into owner from devices d where d.id = device;

  else
    -- rules, commands
    device := rec.device_id;
    row_id := rec.id::text;
    select d.owner_id into owner from devices d where d.id = device;
  end if;

  perform pg_notify('kidscontrol_changes', json_build_object(
    'table', tg_table_name,
    'op', lower(tg_op),
    'id', row_id,
    'deviceId', device,
    'ownerId', owner
  )::text);

  return null;
end;
$$;

create trigger commands_notify
  after insert or update or delete on commands
  for each row execute function notify_change();

create trigger alerts_notify
  after insert or update or delete on alerts
  for each row execute function notify_change();

-- The agent uploads its whole program list at once, and on a Windows machine
-- that is a few hundred rows. A statement-level trigger would be one
-- notification for the batch, but it cannot see which rows changed; per row is
-- affordable because this runs on pairing and then rarely.
create trigger installed_apps_notify
  after insert or update or delete on installed_apps
  for each row execute function notify_change();

-- Alerts are read newest-first per account and acknowledged in bulk.
create index alerts_unacked_idx on alerts (owner_id, created_at desc)
  where acknowledged = false;
