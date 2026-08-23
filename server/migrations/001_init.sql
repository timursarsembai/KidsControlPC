-- Core schema for the self-hosted backend: accounts, devices, rules, commands,
-- activity, alerts. Chat, screenshots, second-parent access and email
-- verification are deliberately out of the first version.
--
-- Shape follows the Firestore tree it replaces (users/{uid}/devices/{id}/...),
-- so the repository layer in shared/ keeps its call signatures.

-- ── Accounts ────────────────────────────────────────────────────────────────

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text        not null,
  password_hash  text,
  email_verified boolean     not null default false,
  legacy_uid     text unique,          -- Firebase Auth uid, kept so the import
                                       -- can be re-run without duplicating rows
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Case-insensitive uniqueness without pulling in the citext extension.
create unique index users_email_key on users (lower(email));

create table profiles (
  user_id             uuid primary key references users (id) on delete cascade,
  plan                text        not null default 'free',
  role                text        not null default 'owner',
  owner_id            uuid references users (id) on delete cascade,
  chat_name           text,
  storage_used_bytes  bigint      not null default 0,
  storage_quota_bytes bigint      not null default 104857600,  -- 100 MB, free plan
  -- Lived in the root users/{uid} document in Firestore; the agent reads it to
  -- decide whether every rule is paused.
  pause_all_rules     boolean     not null default false,
  updated_at          timestamptz not null default now()
);

-- ── Devices ─────────────────────────────────────────────────────────────────

create table devices (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid        not null references users (id) on delete cascade,
  hostname       text,
  os_type        text,
  device_name    text,
  alias          text,
  agent_version  text,
  status         text        not null default 'offline',
  last_seen      timestamptz,
  paired_at      timestamptz,
  settings       jsonb       not null default '{}'::jsonb,
  pomodoro_state jsonb,
  recent_logs    jsonb,                -- last 100 lines pushed by fetch_logs
  legacy_id      text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index devices_owner_idx on devices (owner_id);

-- The secret an agent trades for an access token. Stored hashed: a database
-- dump must not be enough to impersonate a child's PC.
--
-- Rotating this must never make existing rows unreachable — that is exactly
-- the bug that killed delete permissions before. Nothing else in this schema
-- references the secret; commands, rules and logs are keyed by device_id.
create table device_secrets (
  device_id   uuid primary key references devices (id) on delete cascade,
  secret_hash text        not null,
  rotated_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ── Rules ───────────────────────────────────────────────────────────────────

-- payload is jsonb on purpose: a rule's fields change with almost every
-- release of the agent. Only what we filter on gets its own column.
create table rules (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid        not null references devices (id) on delete cascade,
  slug       text,                     -- fixed ids such as 'global_pomodoro'
  status     text        not null default 'active',   -- active | inactive
  payload    jsonb       not null default '{}'::jsonb,
  legacy_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index rules_device_slug_key on rules (device_id, slug) where slug is not null;
create unique index rules_legacy_key on rules (device_id, legacy_id) where legacy_id is not null;
create index rules_device_status_idx on rules (device_id, status);

-- ── Installed applications ──────────────────────────────────────────────────

create table installed_apps (
  device_id  uuid        not null references devices (id) on delete cascade,
  app_id     text        not null,     -- identifier produced by the agent
  name       text,
  path       text,
  publisher  text,
  version    text,
  updated_at timestamptz not null default now(),
  primary key (device_id, app_id)
);

-- ── Commands ────────────────────────────────────────────────────────────────

-- A command is addressed to a device_id, not to a shared secret. The agent is
-- allowed to read it because its token is signed for that device.
create table commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid        not null references devices (id) on delete cascade,
  action       text        not null,
  payload      jsonb       not null default '{}'::jsonb,
  status       text        not null default 'pending',  -- pending|completed|failed
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index commands_pending_idx on commands (device_id) where status = 'pending';
create index commands_cleanup_idx on commands (created_at) where status <> 'pending';

-- ── Activity ────────────────────────────────────────────────────────────────

create table activity_logs (
  id        bigserial primary key,
  device_id uuid        not null references devices (id) on delete cascade,
  ts        timestamptz not null default now(),
  kind      text        not null,      -- app | dns | ...
  payload   jsonb       not null default '{}'::jsonb
);

create index activity_logs_device_ts_idx on activity_logs (device_id, ts desc);

-- Replaces the per-field increment() calls: one upsert merges the counters.
create table activity_stats (
  device_id  uuid        not null references devices (id) on delete cascade,
  date       date        not null,
  counters   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (device_id, date)
);

-- ── Alerts ──────────────────────────────────────────────────────────────────

create table alerts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid        not null references users (id) on delete cascade,
  device_id       uuid references devices (id) on delete set null,
  type            text        not null,
  details         text,
  device_hostname text,
  acknowledged    boolean     not null default false,
  created_at      timestamptz not null default now()
);

create index alerts_owner_idx on alerts (owner_id, created_at desc);

-- ── Pairing ─────────────────────────────────────────────────────────────────

-- target_device_id set => repair pairing: the agent is re-installed on a PC
-- that already exists, and its rules and history must survive.
create table pairing_codes (
  code             text primary key,
  owner_id         uuid        not null references users (id) on delete cascade,
  target_device_id uuid references devices (id) on delete cascade,
  used             boolean     not null default false,
  used_at          timestamptz,
  device_id        uuid,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

create index pairing_codes_expiry_idx on pairing_codes (expires_at);

-- ── Parent sessions ─────────────────────────────────────────────────────────

create table refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references users (id) on delete cascade,
  token_hash text        not null unique,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index refresh_tokens_user_idx on refresh_tokens (user_id);
