-- A child, and the devices that belong to them.
--
-- Until now a device *was* a child: one PC, one set of rules, one name in the
-- panel. That stops working the moment a child has both a computer and a
-- phone, which is where this is heading.
--
-- Called `children`, not `profiles`: "profile" is already taken in this
-- codebase and means a set of restrictions with a schedule (profile_config
-- rules, ProfilePanel). Two meanings of one word in one project is how people
-- end up reading the wrong function.
--
-- Rules stay on the device for now. A shared "two hours a day across all his
-- devices" belongs to the child and will need its own kind of rule; adding it
-- later does not disturb what exists, whereas moving every rule now would
-- touch the agent, the panel and the data in one go.

create table children (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid        not null references users (id) on delete cascade,
  name       text        not null,
  -- Shown next to the name in the panel. An emoji rather than an uploaded
  -- photo: no storage, no moderation, and a picture of somebody's child is
  -- not something to keep without a reason.
  avatar     text        not null default '🙂',
  -- Free-form note for the parent — "3 класс", "спит после 21:00".
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index children_owner_idx on children (owner_id, created_at);

-- A device with no child is not an error: it may be newly paired and not yet
-- assigned, or its child may have been removed. The panel shows those
-- separately rather than hiding them.
alter table devices
  add column child_id uuid references children (id) on delete set null;

create index devices_child_idx on devices (child_id);

-- Every device that already exists gets a child of its own, named after it.
-- The alternative — leaving them unassigned — means the first screen after
-- this update looks like everything disappeared.
--
-- Row by row on purpose: matching a freshly created child back to its device
-- by name would go wrong the moment two devices share one (two PCs both
-- called DESKTOP-PC is not unusual), and both would end up pointing at the
-- same child.
do $$
declare
  d record;
  new_child uuid;
begin
  for d in select id, owner_id, alias, device_name, hostname from devices where child_id is null loop
    insert into children (owner_id, name)
    values (
      d.owner_id,
      coalesce(nullif(d.alias, ''), nullif(d.device_name, ''), nullif(d.hostname, ''), 'Ребёнок')
    )
    returning id into new_child;

    update devices set child_id = new_child where id = d.id;
  end loop;
end $$;

-- notify_change has to learn about children too: the table has no device_id,
-- and without a branch of its own the trigger fails on every insert.
create or replace function notify_change() returns trigger
language plpgsql
as $$
declare
  rec record;
  owner uuid;
  device uuid;
  chat uuid;
  row_id text;
begin
  rec := coalesce(new, old);

  if tg_table_name = 'devices' then
    owner := rec.owner_id;
    device := rec.id;
    row_id := rec.id::text;

  elsif tg_table_name in ('alerts', 'children') then
    -- Both belong straight to the account.
    owner := rec.owner_id;
    row_id := rec.id::text;
    if tg_table_name = 'alerts' then device := rec.device_id; end if;

  elsif tg_table_name = 'chats' then
    owner := rec.owner_id;
    row_id := rec.id::text;
    chat := rec.id;

  elsif tg_table_name = 'chat_messages' then
    chat := rec.chat_id;
    row_id := rec.id::text;
    select c.owner_id into owner from chats c where c.id = chat;

  elsif tg_table_name = 'installed_apps' then
    device := rec.device_id;
    row_id := rec.app_id;
    select d.owner_id into owner from devices d where d.id = device;

  else
    -- rules, commands, screenshots
    device := rec.device_id;
    row_id := rec.id::text;
    select d.owner_id into owner from devices d where d.id = device;
  end if;

  perform pg_notify('kidscontrol_changes', json_build_object(
    'table', tg_table_name,
    'op', lower(tg_op),
    'id', row_id,
    'deviceId', device,
    'chatId', chat,
    'ownerId', owner
  )::text);

  return null;
end;
$$;

create trigger children_notify
  after insert or update or delete on children
  for each row execute function notify_change();
