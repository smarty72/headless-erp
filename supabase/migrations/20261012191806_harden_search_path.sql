-- Vaste search_path voor triggerfuncties (Supabase security advisor 0011).
alter function app.touch_updated_at() set search_path = '';
alter function app.guard_invoice() set search_path = '';
alter function app.guard_invoice_lines() set search_path = '';
