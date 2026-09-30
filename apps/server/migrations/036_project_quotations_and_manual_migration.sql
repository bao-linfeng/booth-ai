CREATE TABLE project_quotation_revisions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK(revision>0),
  quotation_no text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,revision)
);

DO $$
DECLARE default_admin uuid;
BEGIN
  SELECT id INTO default_admin FROM admins WHERE enabled AND 'ROLE_ADMIN'=ANY(roles) ORDER BY created_at,id LIMIT 1;
  IF default_admin IS NULL AND EXISTS(SELECT 1 FROM manual_requests) THEN
    RAISE EXCEPTION 'Active administrator required to migrate manual requests';
  END IF;
  INSERT INTO projects(id,request_no,source_type,customer_user_id,assignee_admin_id,status,request_snapshot,created_at,updated_at)
  SELECT m.id,'MR-'||upper(m.id::text),'manual_request',m.user_id,
    COALESCE((SELECT id FROM admins WHERE id=m.followed_by AND enabled AND 'ROLE_ADMIN'=ANY(roles)),default_admin),
    CASE m.status WHEN 'following_up' THEN 'following' WHEN 'completed' THEN 'closed' ELSE 'pending' END,
    jsonb_build_object('legacyRequestId',m.id,'legacyRequestKey',m.request_key,'originalDescription',m.original_text,
      'confirmedRequirements',m.requirement,'unresolvedQuestions',m.unresolved_questions,'referenceScheme',m.scheme_context,
      'contact',jsonb_build_object('name',m.contact_name,'legacyDetail',m.contact_detail),'entryPoint','matching_results',
      'legacyIncomplete',true),m.created_at,m.updated_at
  FROM manual_requests m;
  INSERT INTO project_events(project_id,kind,actor_admin_id,payload,created_at)
  SELECT id,'legacy_import',followed_by,jsonb_build_object('content',follow_up_note,'legacyStatus',status,
    'reason',CASE WHEN status='completed' THEN '历史人工需求已完成，迁为关闭；未推定成交' ELSE '迁入统一项目' END),updated_at
  FROM manual_requests;
END $$;
DROP TABLE manual_requests;
