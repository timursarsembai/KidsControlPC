-- Change notifications for the WebSocket layer, replacing Firestore's
-- onSnapshot. A trigger announces "row X of table Y changed"; the API process
-- listening on the channel then reads the row and pushes it to whoever is
-- subscribed.
--
-- The payload carries identifiers only, never row contents. NOTIFY is capped
-- at 8000 bytes, and a rule payload is free-form jsonb that could exceed it —
-- a cap that would be discovered in production, on somebody's largest rule.

create or replace function notify_change() returns trigger
language plpgsql
as $$
declare
  rec record;
  owner uuid;
  device uuid;
begin
  rec := coalesce(new, old);

  if tg_table_name = 'devices' then
    owner := rec.owner_id;
    device := rec.id;
  else
    device := rec.device_id;
    -- rules and commands do not carry the owner, and the subscriber list is
    -- keyed by it. One lookup per change is affordable: these tables are
    -- written by a parent clicking, not in a loop.
    select d.owner_id into owner from devices d where d.id = device;
  end if;

  perform pg_notify('kidscontrol_changes', json_build_object(
    'table', tg_table_name,
    'op', lower(tg_op),
    'id', rec.id,
    'deviceId', device,
    'ownerId', owner
  )::text);

  return null;
end;
$$;

-- after ... for each row: the notification must describe a change that is
-- already committed, otherwise a listener can read the old row back.
create trigger devices_notify
  after insert or update or delete on devices
  for each row execute function notify_change();

create trigger rules_notify
  after insert or update or delete on rules
  for each row execute function notify_change();
