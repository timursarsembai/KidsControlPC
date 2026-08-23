-- One-time links sent by email: password recovery and address confirmation.
--
-- Hashed, like refresh tokens and for the same reason: a link that arrives in
-- a mailbox is a credential, and a database dump should not hand over live
-- ones. Short-lived, single-use, and tied to the address they were sent to —
-- so a link stops working the moment the account's address changes.

create table email_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references users (id) on delete cascade,
  purpose    text        not null,   -- password_reset | email_verification
  token_hash text        not null unique,
  -- The address the link was sent to. A recovery link mailed to an old
  -- address must not open an account that has since moved to a new one.
  email      text        not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index email_tokens_user_idx on email_tokens (user_id, purpose);

-- Only one live recovery link per account and purpose: every request replaces
-- the previous one, so a stack of old links in a mailbox is not a stack of
-- working keys.
create unique index email_tokens_live_key on email_tokens (user_id, purpose)
  where used_at is null;
