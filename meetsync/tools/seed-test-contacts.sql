-- Seed 3 realistic test contacts for manual scheduling tests.
-- Uses reserved test chat IDs (999999001-003) so Telegram API calls are
-- intercepted and logged instead of actually sent.
-- Run: cd worker && npx wrangler d1 execute meetsync-db --remote --file=../tools/seed-test-contacts.sql

-- 1. Fake users in the users table
INSERT OR REPLACE INTO users (chat_id, name, phone, username, preferred_language, timezone, context, first_seen, last_seen)
VALUES (
  '999999001',
  'Marco',
  '+35699112233',
  'marcoferr',
  'it',
  'Europe/Rome',
  'Barista at a specialty coffee shop in Valletta. Works rotating early-morning and afternoon shifts. Loves football, cooking, and late-night card games. Close friend of Riccardo since school. They usually meet for dinner or drinks after his shifts.',
  datetime('now', '-30 days'),
  datetime('now', '-1 day')
);

INSERT OR REPLACE INTO users (chat_id, name, phone, username, preferred_language, timezone, context, first_seen, last_seen)
VALUES (
  '999999002',
  'Sofia',
  '+35679445566',
  'sofiac_mt',
  'en',
  'Europe/Malta',
  'Nurse at Mater Dei Hospital, rotating 12-hour shifts. Originally from Gozo, half Chinese-Maltese. Into hiking, gym, and beach days on her off days. Met Riccardo at the gym. They do weekend hikes at Dingli Cliffs or Buskett.',
  datetime('now', '-60 days'),
  datetime('now', '-2 days')
);

INSERT OR REPLACE INTO users (chat_id, name, phone, username, preferred_language, timezone, context, first_seen, last_seen)
VALUES (
  '999999003',
  'Diego',
  '+35677889900',
  'diegoross',
  'en',
  'Europe/Malta',
  'Freelance web developer, works from home in Sliema. Flexible hours but blocks mornings for deep work and has regular client calls. College friend of Riccardo. They play 5-a-side football on Thursday evenings. Also into board games and craft beer.',
  datetime('now', '-90 days'),
  datetime('now', '-3 days')
);

-- 2. Person notes under Riccardo's account (chat_id 909839972)
--    These show up in [STATE] as "People the user has told you about"
--    and carry pre-uploaded schedules for the schedule-on-behalf path.

-- Marco's schedule: Apr 13-19, 2026 (barista rotating shifts)
INSERT OR REPLACE INTO person_notes (owner_chat_id, name, name_normalized, phone, linked_chat_id, schedule_json, notes, created_at, updated_at)
VALUES (
  '909839972',
  'Marco',
  'marco',
  '+35699112233',
  '999999001',
  '[{"date":"2026-04-13","start_time":"06:00","end_time":"14:00","label":"Morning shift"},{"date":"2026-04-14","start_time":"06:00","end_time":"14:00","label":"Morning shift"},{"date":"2026-04-15","start_time":"00:00","end_time":"00:00","label":"Day off"},{"date":"2026-04-16","start_time":"14:00","end_time":"22:00","label":"Afternoon shift"},{"date":"2026-04-17","start_time":"14:00","end_time":"22:00","label":"Afternoon shift"},{"date":"2026-04-18","start_time":"06:00","end_time":"14:00","label":"Morning shift"},{"date":"2026-04-19","start_time":"00:00","end_time":"00:00","label":"Day off"}]',
  'Best friend since high school. Works at Brew & Bean in Valletta. Prefers evening hangouts after morning shifts. Hates early morning plans on his days off. Speaks Italian primarily but understands English.',
  datetime('now', '-5 days'),
  datetime('now', '-1 day')
);

-- Sofia's schedule: Apr 13-19, 2026 (nurse 12h rotating, 3 on / 2 off / 2 nights)
INSERT OR REPLACE INTO person_notes (owner_chat_id, name, name_normalized, phone, linked_chat_id, schedule_json, notes, created_at, updated_at)
VALUES (
  '909839972',
  'Sofia',
  'sofia',
  '+35679445566',
  '999999002',
  '[{"date":"2026-04-13","start_time":"07:00","end_time":"19:00","label":"Day shift"},{"date":"2026-04-14","start_time":"07:00","end_time":"19:00","label":"Day shift"},{"date":"2026-04-15","start_time":"07:00","end_time":"19:00","label":"Day shift"},{"date":"2026-04-16","start_time":"00:00","end_time":"00:00","label":"Day off"},{"date":"2026-04-17","start_time":"00:00","end_time":"00:00","label":"Day off"},{"date":"2026-04-18","start_time":"19:00","end_time":"07:00","label":"Night shift"},{"date":"2026-04-19","start_time":"19:00","end_time":"07:00","label":"Night shift"}]',
  'Gym buddy. Lives in Gozo but commutes to Mater Dei for work. On her off days she is usually up for outdoor stuff — hikes, beach. Not a night owl, prefers daytime hangouts. Vegetarian.',
  datetime('now', '-10 days'),
  datetime('now', '-2 days')
);

-- Diego's schedule: Apr 13-19, 2026 (freelancer, flexible but with blocks)
INSERT OR REPLACE INTO person_notes (owner_chat_id, name, name_normalized, phone, linked_chat_id, schedule_json, notes, created_at, updated_at)
VALUES (
  '909839972',
  'Diego',
  'diego',
  '+35677889900',
  '999999003',
  '[{"date":"2026-04-13","start_time":"09:00","end_time":"17:00","label":"Client project"},{"date":"2026-04-14","start_time":"10:00","end_time":"13:00","label":"Client calls"},{"date":"2026-04-15","start_time":"09:00","end_time":"12:00","label":"Deep work"},{"date":"2026-04-15","start_time":"14:00","end_time":"17:00","label":"Team meetings"},{"date":"2026-04-16","start_time":"00:00","end_time":"00:00","label":"Personal day"},{"date":"2026-04-17","start_time":"09:00","end_time":"15:00","label":"Client work"},{"date":"2026-04-18","start_time":"00:00","end_time":"00:00","label":"Weekend off"},{"date":"2026-04-19","start_time":"00:00","end_time":"00:00","label":"Weekend off"}]',
  'College mate from UoM. Lives in Sliema. Plays football with Riccardo on Thursdays. Down for spontaneous plans, especially if food or board games are involved. Has a dog named Pixel that he sometimes brings to outdoor meetups.',
  datetime('now', '-15 days'),
  datetime('now', '-3 days')
);
