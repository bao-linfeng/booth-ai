ALTER TABLE projects DROP COLUMN attribution;

UPDATE project_operations
SET receipt = receipt - 'attribution'
WHERE operation = 'assignee' AND receipt ? 'attribution';
