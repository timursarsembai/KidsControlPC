-- What kind of device this is.
--
-- os_type already exists, but it holds whatever the agent's os.type() returned
-- — 'Windows_NT' today, anything at all from a future Android build. The panel
-- has to decide by this what to show: a phone will have a map and a microphone
-- where a PC has installed programs, and that decision should not rest on
-- string-matching a field the client fills in freely.
--
-- Only 'windows' is produced today. The other two are listed so that when the
-- Android app arrives the value it sends is already the agreed one, rather
-- than each side inventing its own spelling.

alter table devices
  add column platform text not null default 'windows'
    check (platform in ('windows', 'android', 'ios'));
