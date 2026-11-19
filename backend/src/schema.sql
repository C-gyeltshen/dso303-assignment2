-- Idempotent schema; applied by the migrate Lambda on every deploy.
CREATE TABLE IF NOT EXISTS exams (
  id                SERIAL PRIMARY KEY,
  title             TEXT        NOT NULL,
  course            TEXT,
  opens_at          TIMESTAMPTZ NOT NULL,
  closes_at         TIMESTAMPTZ NOT NULL,
  duration_mins     INT         NOT NULL CHECK (duration_mins BETWEEN 1 AND 600),
  created_by        TEXT        NOT NULL,
  results_released  BOOLEAN     NOT NULL DEFAULT FALSE,
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id              SERIAL PRIMARY KEY,
  exam_id         INT  NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  position        INT  NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('mcq', 'short')),
  text            TEXT NOT NULL,
  options         JSONB,
  correct_option  INT,
  marks           INT  NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS questions_exam_idx ON questions(exam_id, position);

CREATE TABLE IF NOT EXISTS attempts (
  id             SERIAL PRIMARY KEY,
  exam_id        INT         NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_sub    TEXT        NOT NULL,
  student_email  TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'marked')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline       TIMESTAMPTZ NOT NULL,
  answers        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  client_seq     INT         NOT NULL DEFAULT 0,
  saved_at       TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  mcq_score      NUMERIC,
  short_marks    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  total_score    NUMERIC,
  max_score      NUMERIC,
  notified_at    TIMESTAMPTZ,
  UNIQUE (exam_id, student_sub)
);
CREATE INDEX IF NOT EXISTS attempts_student_idx ON attempts(student_sub);

CREATE TABLE IF NOT EXISTS assignments (
  id           SERIAL PRIMARY KEY,
  title        TEXT        NOT NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  tutor_email  TEXT        NOT NULL,
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id             SERIAL PRIMARY KEY,
  assignment_id  INT         NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_sub    TEXT        NOT NULL,
  student_email  TEXT,
  s3_key         TEXT        NOT NULL UNIQUE,
  file_name      TEXT        NOT NULL,
  size_bytes     BIGINT      NOT NULL,
  status         TEXT        NOT NULL CHECK (status IN ('received', 'rejected')),
  reason         TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_assignment_idx ON submissions(assignment_id);
