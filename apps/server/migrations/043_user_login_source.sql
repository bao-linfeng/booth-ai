ALTER TABLE users
  ADD COLUMN last_login_source text CHECK (last_login_source IN ('password', 'sso_token'));
