CREATE TABLE dictionaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dictionary_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dictionary_id uuid NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
  item_value text NOT NULL,
  item_label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dictionary_id, item_value)
);

CREATE INDEX dictionary_items_dictionary_id_idx ON dictionary_items(dictionary_id, sort_order);
