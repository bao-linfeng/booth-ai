CREATE TABLE project_assignment_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_assignee_admin_id uuid REFERENCES admins(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by uuid REFERENCES admins(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO project_assignment_config(id) VALUES(true);
