-- =============================================================================
-- Phase 2 – Modules M2 à M5, zonages versionnés, données de référence tracées
-- =============================================================================

-- Piste détectée sans conclusion ferme (M3 sans notification, M4) : jamais de montant.
alter type app.opportunity_status add value if not exists 'a_confirmer';

-- -----------------------------------------------------------------------------
-- Opportunités : résultats de simulation hors totaux (M5)
-- -----------------------------------------------------------------------------
alter table public.opportunities add column counts_in_totals boolean not null default true;

create or replace function app.guard_opportunity() returns trigger language plpgsql as $$
begin
  if (new.calculation_run_id, new.module_id, new.module_version, new.kind, new.year, new.estimated_low,
      new.estimated_central, new.estimated_high, new.status, new.detail, new.counts_in_totals)
     is distinct from
     (old.calculation_run_id, old.module_id, old.module_version, old.kind, old.year, old.estimated_low,
      old.estimated_central, old.estimated_high, old.status, old.detail, old.counts_in_totals) then
    raise exception 'Les montants estimés d''une opportunité sont immuables' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- calculation_runs : données de référence utilisées (zonages, dispositifs)
-- -----------------------------------------------------------------------------
alter table public.calculation_runs
  add column reference_ids jsonb not null default '{"zoningDatasets":[],"zoningEntries":[],"zoneSchemes":[]}'::jsonb,
  add column reference_snapshot jsonb not null default '{"zoningDatasets":[],"zoningEntries":[],"zoneSchemes":[]}'::jsonb;

-- -----------------------------------------------------------------------------
-- Données M2 / M3
-- -----------------------------------------------------------------------------
alter table public.apprenticeship_contracts
  add column diploma_level smallint check (diploma_level between 1 and 8),
  add column end_date date,
  add column start_date_approximate boolean not null default false,
  add constraint apprenticeship_aid_amount_positive check (aid_amount_received is null or aid_amount_received >= 0),
  add constraint apprenticeship_end_after_start check (end_date is null or end_date >= start_date);

alter table public.establishment_rates
  add column payroll_mass numeric(14,2) check (payroll_mass >= 0),
  add column notified_rate_validated boolean not null default false,
  add column applied_rate_validated boolean not null default false,
  add constraint establishment_rates_rates_range check (
    (notified_rate is null or notified_rate between 0 and 1) and (applied_rate is null or applied_rate between 0 and 1)),
  -- Un taux notifié n'est « validé » que s'il est rattaché à une notification officielle.
  add constraint establishment_rates_validated_needs_document check (not notified_rate_validated or source_document_id is not null);

-- -----------------------------------------------------------------------------
-- Zonages versionnés : un jeu de données sourcé par type de zone et par période
-- -----------------------------------------------------------------------------
create table public.zoning_datasets (
  id uuid primary key default gen_random_uuid(),
  zone_type text not null check (zone_type ~ '^[a-z0-9_]+$'),
  valid_from date not null,
  valid_to date,
  source_url text not null,
  source_label text not null,
  version int not null default 1 check (version >= 1),
  status app.parameter_status not null default 'brouillon',
  dataset app.parameter_dataset not null default 'officiel',
  author_id uuid references public.users (id),
  validator_id uuid references public.users (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (validator_id is null or author_id is null or validator_id <> author_id),
  check (status not in ('valide', 'publie') or validator_id is not null),
  unique (zone_type, dataset, valid_from, version)
);

-- Les entrées existantes (aucune en phase 1) sont désormais rattachées à un jeu sourcé.
alter table public.zoning_entries
  add column dataset_id uuid not null references public.zoning_datasets (id),
  alter column source_url drop not null,
  alter column source_label drop not null,
  drop constraint if exists zoning_entries_zone_type_insee_code_valid_from_version_key;
alter table public.zoning_entries alter column zone_type drop not null;
create unique index zoning_entries_dataset_commune on public.zoning_entries (dataset_id, insee_code, valid_from);
create index zoning_entries_insee on public.zoning_entries (insee_code);
alter table public.zoning_entries add constraint zoning_entries_insee_format check (insee_code ~ '^[0-9][0-9AB][0-9]{3}$');

create table public.zone_schemes (
  id uuid primary key default gen_random_uuid(),
  zone_type text not null,
  code text not null,
  name text not null,
  description text not null,
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  documents_to_provide jsonb not null default '[]'::jsonb check (jsonb_typeof(documents_to_provide) = 'array'),
  source_url text,
  valid_from date not null,
  valid_to date,
  version int not null default 1,
  status app.parameter_status not null default 'a_renseigner',
  dataset app.parameter_dataset not null default 'officiel',
  author_id uuid references public.users (id),
  validator_id uuid references public.users (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (status not in ('valide', 'publie') or (source_url is not null and validator_id is not null)),
  check (validator_id is null or author_id is null or validator_id <> author_id),
  unique (zone_type, code, dataset, valid_from, version)
);

alter table public.reference_test_cases
  add column code text unique,
  add column calculation text;

-- -----------------------------------------------------------------------------
-- Cycle de vie générique des données de référence (mêmes règles que les paramètres)
-- -----------------------------------------------------------------------------
create or replace function app.guard_reference_lifecycle() returns trigger language plpgsql as $$
declare
  volatile_cols text[] := array['status', 'validator_id', 'published_at'];
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('a_renseigner', 'brouillon') and not app.is_service() then
      raise exception 'Création au statut a_renseigner ou brouillon uniquement' using errcode = '42501';
    end if;
    if not app.is_service() then new.author_id := auth.uid(); end if;
    return new;
  end if;

  if old.status not in ('a_renseigner', 'brouillon') and (to_jsonb(new) - volatile_cols) is distinct from (to_jsonb(old) - volatile_cols) then
    raise exception '% validé : toute modification doit créer une nouvelle version', tg_table_name using errcode = '42501';
  end if;

  allowed := old.status = new.status or (old.status, new.status) in (
    ('a_renseigner', 'brouillon'), ('brouillon', 'a_renseigner'), ('brouillon', 'valide'), ('valide', 'brouillon'),
    ('valide', 'publie'), ('publie', 'archive'), ('valide', 'archive'), ('brouillon', 'archive'));
  if not allowed then
    raise exception 'Transition de statut interdite : % -> %', old.status, new.status using errcode = '42501';
  end if;

  if new.status = 'valide' and old.status <> 'valide' then
    if not app.is_service() then new.validator_id := auth.uid(); end if;
    if new.validator_id is null or new.validator_id = new.author_id then
      raise exception 'Validation par un second utilisateur habilité obligatoire (quatre yeux)' using errcode = '42501';
    end if;
  end if;

  if new.status = 'publie' and old.status <> 'publie' then
    new.published_at := now();
    if tg_table_name = 'zoning_datasets' then
      update public.zoning_datasets d set status = 'archive'
       where d.id <> new.id and d.zone_type = new.zone_type and d.dataset = new.dataset and d.status = 'publie'
         and d.valid_from <= coalesce(new.valid_to, 'infinity'::date) and coalesce(d.valid_to, 'infinity'::date) >= new.valid_from;
    else
      update public.zone_schemes s set status = 'archive'
       where s.id <> new.id and s.zone_type = new.zone_type and s.code = new.code and s.dataset = new.dataset and s.status = 'publie'
         and s.valid_from <= coalesce(new.valid_to, 'infinity'::date) and coalesce(s.valid_to, 'infinity'::date) >= new.valid_from;
    end if;
  end if;
  return new;
end $$;

create trigger t_zoning_datasets_guard before insert or update on public.zoning_datasets for each row execute function app.guard_reference_lifecycle();
create trigger t_zone_schemes_guard before insert or update on public.zone_schemes for each row execute function app.guard_reference_lifecycle();
create trigger t_zoning_datasets_nodelete before delete on public.zoning_datasets for each row execute function app.forbid_delete();
create trigger t_zone_schemes_nodelete before delete on public.zone_schemes for each row execute function app.forbid_delete();
create trigger t_log_zoning_datasets after insert or update on public.zoning_datasets for each row execute function app.log_change();
create trigger t_log_zone_schemes after insert or update on public.zone_schemes for each row execute function app.log_change();

-- Les communes d'un jeu ne changent plus une fois le jeu validé.
create or replace function app.guard_zoning_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  st app.parameter_status;
begin
  select d.status into st from public.zoning_datasets d where d.id = coalesce(new.dataset_id, old.dataset_id);
  if st not in ('a_renseigner', 'brouillon') then
    raise exception 'Jeu de zonage validé : communes non modifiables (créer une nouvelle version)' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.dataset_id <> old.dataset_id then
    raise exception 'Changement de jeu de zonage interdit' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger t_zoning_entry_guard before insert or update or delete on public.zoning_entries for each row execute function app.guard_zoning_entry();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.zoning_datasets enable row level security;
alter table public.zoning_datasets force row level security;
alter table public.zone_schemes enable row level security;
alter table public.zone_schemes force row level security;

create policy p_select on public.zoning_datasets for select to authenticated using (app.is_internal());
create policy p_insert on public.zoning_datasets for insert to authenticated with check (app.is_admin());
create policy p_update on public.zoning_datasets for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy p_select on public.zone_schemes for select to authenticated using (app.is_internal());
create policy p_insert on public.zone_schemes for insert to authenticated with check (app.is_admin());
create policy p_update on public.zone_schemes for update to authenticated using (app.is_admin()) with check (app.is_admin());

-- zoning_entries : modification et suppression par un administrateur, tant que le jeu n'est pas validé.
create policy p_update on public.zoning_entries for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy p_delete on public.zoning_entries for delete to authenticated using (app.is_admin());

grant execute on all functions in schema app to authenticated, service_role;
