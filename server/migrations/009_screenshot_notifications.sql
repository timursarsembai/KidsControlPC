-- Live delivery for screenshots: a parent watching the screen of a child's PC
-- should see a new one appear, not discover it on the next refresh.
create trigger screenshots_notify
  after insert or update or delete on screenshots
  for each row execute function notify_change();
