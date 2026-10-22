-- Drop legacy backup/archive tables created by historical migrations.
-- None of these tables are referenced in application code or have ongoing business use.

DROP TABLE IF EXISTS catalog_options_legacy;
DROP TABLE IF EXISTS scheme_selection_migration_backup;
DROP TABLE IF EXISTS scheme_opening_directions_archive;
DROP TABLE IF EXISTS retired_size_dictionary_backup;
DROP TABLE IF EXISTS imported_dimension_orientation_backup;
