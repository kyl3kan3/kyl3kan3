-- Workspace response deadlines must never replace provider completion due dates.
alter table tickets add column if not exists response_due_at timestamptz;
