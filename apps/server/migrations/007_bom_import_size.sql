ALTER TABLE bom_imports ADD COLUMN source_byte_size bigint CHECK (source_byte_size >= 0);
