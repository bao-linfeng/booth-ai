ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0);
ALTER TABLE admins ADD COLUMN session_version integer NOT NULL DEFAULT 1 CHECK (session_version > 0);

CREATE FUNCTION revoke_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.enabled AND NOT NEW.enabled) OR OLD.external_user_id IS DISTINCT FROM NEW.external_user_id THEN
    NEW.session_version := OLD.session_version + 1;
  ELSIF TG_TABLE_NAME = 'admins' THEN
    IF 'ROLE_ADMIN' = ANY(OLD.roles) AND NOT ('ROLE_ADMIN' = ANY(NEW.roles)) THEN
      NEW.session_version := OLD.session_version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_revoke_sessions BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION revoke_account_sessions();
CREATE TRIGGER admins_revoke_sessions BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION revoke_account_sessions();
