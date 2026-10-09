-- 客服设置页按收件人展示离线通知投递状态（最近送达、永久失败、待发）
CREATE INDEX cs_email_outbox_recipient_idx ON cs_email_outbox(recipient, kind);
