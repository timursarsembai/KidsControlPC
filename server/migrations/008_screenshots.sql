-- Screenshots taken on a child's PC.
--
-- The image itself goes to a file on disk, not into the database: a few
-- hundred kilobytes per row would bloat every dump and every backup, and the
-- one thing anybody does with a screenshot is fetch it whole.
--
-- No MinIO. An S3 service would add ~300 MB of RAM on a box with 3 GB free, to
-- store files that never leave this machine.

create table screenshots (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid        not null references devices (id) on delete cascade,
  -- Kept alongside device_id so quota accounting and cleanup do not have to
  -- join back through devices for every row.
  owner_id    uuid        not null references users (id) on delete cascade,
  -- Path relative to the storage root. Absolute paths in a database survive
  -- exactly until the volume is mounted somewhere else.
  path        text        not null,
  size_bytes  bigint      not null,
  source      text,                    -- request | schedule | trigger
  width       integer,
  quality     integer,
  status      text        not null default 'ready',
  legacy_id   text,
  created_at  timestamptz not null default now(),
  -- Three days, same as the Firebase agent used. Screenshots are the most
  -- privacy-sensitive thing here and the least useful once they are old.
  expires_at  timestamptz not null default now() + interval '3 days'
);

create index screenshots_device_idx on screenshots (device_id, created_at desc);
create index screenshots_expiry_idx on screenshots (expires_at);
create unique index screenshots_legacy_key on screenshots (device_id, legacy_id)
  where legacy_id is not null;
