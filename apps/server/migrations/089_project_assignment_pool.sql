-- 承接人失效时照常受理：项目进入待分配池（承接人为空），由有分配权限的人分配或由符合承接条件的人领取
ALTER TABLE projects ALTER COLUMN assignee_admin_id DROP NOT NULL;
CREATE INDEX projects_unassigned_idx ON projects (created_at)
  WHERE assignee_admin_id IS NULL AND status IN ('pending', 'following', 'quoted');

-- 通知可见范围：all 全员可见；assigners 只对有分配权限的人可见；recipient 只对指定管理员可见
ALTER TABLE project_notification_outbox
  ADD COLUMN audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'assigners', 'recipient')),
  ADD COLUMN recipient_admin_id uuid REFERENCES admins(id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_notification_outbox_recipient_check
    CHECK ((audience = 'recipient') = (recipient_admin_id IS NOT NULL));
