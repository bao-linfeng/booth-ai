CREATE TABLE applicability_questions (
  id          text        PRIMARY KEY CHECK (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  label       text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  help_text   text        NOT NULL DEFAULT '' CHECK (char_length(help_text) <= 1000),
  sort_order  integer     NOT NULL DEFAULT 0,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO applicability_questions (id, label, help_text, sort_order) VALUES
  ('outdoor_venue',       '展位是否位于户外场馆或半开放空间？', '如露天展场、临时帐篷、半开放式会展中心等，因结构及防水要求不同，部分方案仅适用于室内封闭场馆。', 10),
  ('full_enclosure_ok',   '展位是否允许全封闭围合结构？', '全封闭结构四面均有展墙，无开放通道；部分主办方或展馆规定禁止全封闭结构，请确认后作答。', 20),
  ('floor_load_heavy',    '展馆地面是否支持重型地板或高台搭建？', '高台地板、石材铺装等会显著增加地面荷载。请向展馆确认地面承重标准（通常要求 ≥ 500 kg/㎡）。', 30),
  ('double_deck_allowed', '展位是否允许搭建双层结构？', '双层展台需提前向展馆及主办方申请，并提供结构计算书，部分展馆明令禁止双层结构。', 40),
  ('rigging_allowed',     '场馆是否允许从天花板悬挂吊挂物？', '部分展馆限制吊挂重量或不允许任何悬挂，请提前与主办方确认吊挂许可及最大荷载。', 50);
