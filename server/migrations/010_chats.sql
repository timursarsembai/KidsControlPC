-- Chat between a parent and a child's PC.
--
-- Kept close to the Firestore shape it replaces: the panel and the widget on
-- the child's machine are written against it, and this migration is not the
-- place to also redesign the feature.
--
-- Membership is two arrays rather than a join table. They are read on every
-- message, never queried across chats, and hold at most a handful of ids —
-- a table would mean a join for something a jsonb array answers in place.

create table chats (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid        not null references users (id) on delete cascade,
  type         text        not null default 'direct',   -- direct | group
  name         text        not null default '',
  -- Direct chats belong to the parent who started them; group chats are
  -- visible to every parent on the account.
  created_by   uuid references users (id) on delete set null,
  device_ids   uuid[]      not null default '{}',
  parent_ids   uuid[]      not null default '{}',
  -- Denormalised on purpose: the chat list shows the last line of every
  -- conversation, and reading it from the messages table would be one query
  -- per chat on every render.
  last_message jsonb,
  legacy_id    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index chats_owner_idx on chats (owner_id, updated_at desc);
create index chats_devices_idx on chats using gin (device_ids);
create unique index chats_legacy_key on chats (owner_id, legacy_id) where legacy_id is not null;

create table chat_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid        not null references chats (id) on delete cascade,
  text           text        not null default '',
  -- Sender: a parent has a user id, a child's PC has a device id. Exactly one
  -- of them is set, which the check below enforces — a message from nobody
  -- would render as if it came from whoever the reader is.
  sender_type    text        not null,                  -- parent | child
  sender_user_id uuid references users (id) on delete set null,
  sender_device_id uuid references devices (id) on delete set null,
  sender_name    text        not null default '',
  -- Attachment, if any. Stored the same way screenshots are: bytes on disk,
  -- metadata here.
  file_path      text,
  file_name      text,
  file_size      bigint,
  mime_type      text,
  file_deleted   boolean     not null default false,
  gif_url        text,
  gif_preview_url text,
  -- Who has seen it. Ids of devices and parents mixed together, as they were
  -- in Firestore, because both sides tick the same boxes.
  read_by        text[]      not null default '{}',
  delivered_to   text[]      not null default '{}',
  legacy_id      text,
  created_at     timestamptz not null default now(),

  constraint chat_messages_sender_check check (
    (sender_type = 'parent' and sender_user_id is not null)
    or (sender_type = 'child' and sender_device_id is not null)
  )
);

create index chat_messages_chat_idx on chat_messages (chat_id, created_at asc);
create unique index chat_messages_legacy_key on chat_messages (chat_id, legacy_id)
  where legacy_id is not null;

-- notify_change has to learn about these two: a chat has no device_id, and a
-- message belongs to a chat rather than to a device. Without this the trigger
-- fails on every insert and the whole write fails with it.
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

  elsif tg_table_name = 'alerts' then
    owner := rec.owner_id;
    device := rec.device_id;
    row_id := rec.id::text;

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

create trigger chats_notify
  after insert or update or delete on chats
  for each row execute function notify_change();

create trigger chat_messages_notify
  after insert or update or delete on chat_messages
  for each row execute function notify_change();
