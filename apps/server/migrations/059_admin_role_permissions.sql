CREATE TABLE admin_roles (
  id bigint PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  permission_codes text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

UPDATE admins SET permissions = '{}';

CREATE OR REPLACE FUNCTION revoke_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.enabled AND NOT NEW.enabled)
    OR OLD.external_user_id IS DISTINCT FROM NEW.external_user_id
    OR (TG_TABLE_NAME = 'admins' AND OLD.roles IS DISTINCT FROM NEW.roles) THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
