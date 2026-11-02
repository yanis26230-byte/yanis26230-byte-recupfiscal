-- =============================================================================
-- Phase 5 – Rapports PDF
-- =============================================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  calculation_run_id uuid not null references public.calculation_runs (id) on delete cascade,
  template_version text not null,
  storage_path text not null unique,
  sha256 char(64) not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Un rapport par calcul et par version de modèle : régénérer renvoie le même document.
  unique (calculation_run_id, template_version)
);
create index reports_audit on public.reports (audit_id);
alter table public.reports enable row level security;
alter table public.reports force row level security;
create policy p_select on public.reports for select to authenticated using (app.can_read_audit(audit_id));
create trigger t_reports_immutable before update on public.reports for each row execute function app.forbid_mutation();

-- Seau privé des rapports, chemin « <audit_id>/<fichier> ».
insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
create or replace function app.storage_audit(object_name text) returns uuid language plpgsql immutable as $$
declare s text := split_part(object_name, '/', 1);
begin
  if s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return s::uuid; end if;
  return null;
end $$;
create policy reports_select on storage.objects for select to authenticated
  using (bucket_id = 'reports' and app.can_read_audit(app.storage_audit(name)));
grant execute on all functions in schema app to authenticated, service_role;
