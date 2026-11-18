CREATE TABLE learner_progress (
  user_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  generation TEXT NOT NULL,
  imported_guest INTEGER NOT NULL DEFAULT 0 CHECK (imported_guest IN (0, 1)),
  progress TEXT NOT NULL CHECK (json_valid(progress) AND length(progress) <= 4096)
);
