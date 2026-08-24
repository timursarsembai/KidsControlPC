-- A second parent: an invitation by email, and the access it grants.
--
-- The shape follows the Firebase version, including its limit: a parent helps
-- with exactly one account. That is what profiles.owner_id already encodes,
-- and widening it would mean an account switcher in a panel that has nowhere
-- to put one.

create table parent_invitations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid        not null references users (id) on delete cascade,
  email           text        not null,
  -- Filled once the invited person has an account. Null while the invitation
  -- is addressed to someone who has never signed in here.
  invited_user_id uuid references users (id) on delete set null,
  status          text        not null default 'pending',  -- pending|accepted|declined|expired
  -- Whether this invitation created the account. Declining such an invitation
  -- leaves an account nobody asked for, so it is removed with it.
  account_created boolean     not null default false,
  token_hash      text        not null unique,
  expires_at      timestamptz not null,
  responded_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- One live invitation per address per owner. Sending a second one should
-- replace the first, not leave two working links in a mailbox.
create unique index parent_invitations_pending_key
  on parent_invitations (owner_id, lower(email))
  where status = 'pending';

create index parent_invitations_owner_idx on parent_invitations (owner_id, created_at desc);

-- Who may act on whose account.
--
-- Revoking sets status rather than deleting the row: a parent who was removed
-- and later invited again should look like the same person in the history,
-- and "was there ever access here" is a question worth being able to answer.
create table parent_access (
  owner_id      uuid        not null references users (id) on delete cascade,
  parent_id     uuid        not null references users (id) on delete cascade,
  status        text        not null default 'active',     -- active|revoked
  invitation_id uuid references parent_invitations (id) on delete set null,
  accepted_at   timestamptz not null default now(),
  revoked_at    timestamptz,
  primary key (owner_id, parent_id)
);

create index parent_access_parent_idx on parent_access (parent_id) where status = 'active';

-- An owner cannot be their own second parent.
alter table parent_access add constraint parent_access_not_self check (owner_id <> parent_id);
