-- Deleting an account was impossible if it had ever written a message.
--
-- sender_user_id is "on delete set null", and the check demanded it be present
-- for a parent message. Postgres nulls the column, the check refuses the row,
-- and the whole delete fails — including the one a parent asks for when they
-- want their account gone.
--
-- The check moves to insert time, where it belongs: a message is written with
-- an author, and losing that author later turns it into "someone who is no
-- longer here", which is exactly what the history should show. sender_name is
-- kept on the row, so the conversation still reads correctly.
alter table chat_messages drop constraint chat_messages_sender_check;

alter table chat_messages
  add constraint chat_messages_sender_type_check
  check (sender_type in ('parent', 'child'));
