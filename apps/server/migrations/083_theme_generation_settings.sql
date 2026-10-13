-- 换主题生图流水线的全局设置（单行）。提交任务时冻结进 generation_snapshot.options，修改只影响新任务。
-- send_mask：是否把蒙版发给支持蒙版的供应商；composite：出图后按蒙版把可编辑区域合成回原图；
-- background_*：原图透明背景在发送前是保持透明还是铺纯色。
CREATE TABLE theme_generation_settings (
  id               boolean PRIMARY KEY DEFAULT TRUE,
  send_mask        boolean NOT NULL DEFAULT TRUE,
  composite        boolean NOT NULL DEFAULT FALSE,
  background_mode  text NOT NULL DEFAULT 'fill' CHECK (background_mode IN ('transparent', 'fill')),
  background_color text NOT NULL DEFAULT '#E8EAEE' CHECK (background_color ~ '^#[0-9A-F]{6}$'),
  revision         integer NOT NULL DEFAULT 1,
  updated_by       uuid REFERENCES admins(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_generation_settings_singleton CHECK (id = TRUE)
);

INSERT INTO theme_generation_settings (id) VALUES (TRUE);
