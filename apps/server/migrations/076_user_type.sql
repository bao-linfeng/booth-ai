ALTER TABLE users
  ADD COLUMN user_type text NOT NULL DEFAULT 'client'
  CHECK (user_type IN ('client', 'su'));
