-- 积分对账无法自动修复的问题（最近一次对账结论，修复后清空），供管理端生成任务页展示与筛选。
ALTER TABLE theme_jobs ADD COLUMN credit_issue text, ADD COLUMN credit_issue_at timestamptz;
ALTER TABLE artwork_jobs ADD COLUMN credit_issue text, ADD COLUMN credit_issue_at timestamptz;
CREATE INDEX theme_jobs_credit_issue_idx ON theme_jobs(credit_issue_at) WHERE credit_issue IS NOT NULL;
CREATE INDEX artwork_jobs_credit_issue_idx ON artwork_jobs(credit_issue_at) WHERE credit_issue IS NOT NULL;
