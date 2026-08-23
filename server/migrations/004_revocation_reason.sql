-- Why a refresh token was revoked.
--
-- Presenting an already-spent token is how a stolen copy shows itself, and the
-- answer to that is to end every session the account has. But tokens are also
-- revoked for entirely innocent reasons — a password change, a sign-out — and
-- treating those the same way turns a normal action into a trap: change your
-- password, and the tab you left open in the next window presents its old
-- token, gets classified as a thief, and throws you out of the session you are
-- actually using.
--
-- 'rotated' is the only reason that means "this token was alive and got
-- replaced", which is the only case where a second use is suspicious.

alter table refresh_tokens
  add column revoked_reason text;

comment on column refresh_tokens.revoked_reason is
  'rotated | password_change | logout | reuse_detected — only rotated triggers the stolen-token response';
