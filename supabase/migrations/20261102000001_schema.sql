-- =============================================================================
-- Schéma initial – Plateforme de récupération fiscale et sociale (Phase 1)
-- Cible : Supabase (PostgreSQL 15+), région UE. Dépend de auth.users / auth.uid().
-- Principe : RLS activée sur TOUTES les tables. Le rôle anon n'a aucune politique :
-- le parcours sans compte passe par des actions serveur (service_role).
-- =============================================================================

create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type app.member_role as enum ('proprietaire', 'collaborateur', 'comptable_invite');
create type app.internal_role as enum ('analyste', 'administrateur');
create type app.audit_mode as enum ('rapide', 'avance');
create type app.audit_status as enum ('brouillon', 'en_cours', 'calcule', 'archive');
create type app.parameter_status as enum ('a_renseigner', 'brouillon', 'valide', 'publie', 'archive');
create type app.parameter_dataset as enum ('officiel', 'test');
create type app.opportunity_kind as enum ('recuperation_passee', 'economie_future');
create type app.opportunity_status as enum ('estime', 'parametre_manquant', 'informations_manquantes', 'non_reclamable', 'aucun_ecart');
create type app.confidence_level as enum ('eleve', 'moyen', 'faible');
create type app.risk_level as enum ('faible', 'standard', 'eleve');
create type app.review_status as enum ('a_examiner', 'valide', 'rejete');
create type app.case_status as enum (
  'nouveau', 'informations_manquantes', 'en_analyse', 'a_valider_expert', 'pret_a_deposer',
  'depose', 'en_attente_reponse', 'accepte', 'refuse', 'rembourse', 'cloture');
create type app.mandate_status as enum ('a_signer', 'envoye', 'signe', 'refuse', 'expire', 'annule');
create type app.document_status as enum ('recu', 'controle', 'rejete', 'en_extraction', 'extrait', 'valide');
create type app.field_status as enum ('a_valider', 'valide', 'corrige', 'rejete');
create type app.lead_status as enum ('nouveau', 'lien_envoye', 'compte_cree', 'qualifie', 'perdu');
create type app.aid_received as enum ('oui', 'non', 'partiellement', 'inconnu');

-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- -----------------------------------------------------------------------------
-- Utilisateurs
-- -----------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text,
  phone text,
  internal_role app.internal_role, -- null = client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Entreprises et membres
-- -----------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  siren char(9) not null unique check (siren ~ '^[0-9]{9}$'),
  legal_name text not null,
  legal_form text,
  naf_code text,
  sector text,
  created_on date,
  headcount_range text,
  tax_regime text,
  vat_regime text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  user_id uuid not null references public.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role app.member_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index on public.company_members (company_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role app.member_role not null check (role <> 'proprietaire'),
  token_hash text not null unique,
  invited_by uuid not null references public.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  siret char(14) not null unique check (siret ~ '^[0-9]{14}$'),
  address text,
  postal_code text,
  city text,
  insee_code text,
  at_risk_code text,
  is_head_office boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index on public.establishments (company_id);

-- -----------------------------------------------------------------------------
-- Fonctions d'autorisation (SECURITY DEFINER : évitent la récursion RLS)
-- -----------------------------------------------------------------------------
create or replace function app.is_service() returns boolean language sql stable as $$
  select current_user not in ('anon', 'authenticated')
$$;

create or replace function app.internal_role() returns app.internal_role
language sql stable security definer set search_path = '' as $$
  select u.internal_role from public.users u where u.id = auth.uid()
$$;

create or replace function app.is_internal() returns boolean language sql stable as $$
  select coalesce(app.internal_role() is not null, false)
$$;

create or replace function app.is_admin() returns boolean language sql stable as $$
  select coalesce(app.internal_role() = 'administrateur', false)
$$;

create or replace function app.company_role(cid uuid) returns app.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.company_members m where m.company_id = cid and m.user_id = auth.uid()
$$;

create or replace function app.is_company_member(cid uuid) returns boolean language sql stable as $$
  select cid is not null and app.company_role(cid) is not null
$$;

-- Propriétaire ou collaborateur : écriture des données de l'entreprise.
create or replace function app.can_write_company(cid uuid) returns boolean language sql stable as $$
  select coalesce(app.company_role(cid) in ('proprietaire', 'collaborateur'), false)
$$;

-- Comptable invité : lecture seule + dépôt de documents.
create or replace function app.can_upload_company(cid uuid) returns boolean language sql stable as $$
  select app.company_role(cid) is not null
$$;

-- -----------------------------------------------------------------------------
-- Prospects et audits
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  phone text,
  siren char(9) check (siren is null or siren ~ '^[0-9]{9}$'),
  consent boolean not null check (consent),
  consent_text_version text not null,
  consent_at timestamptz not null default now(),
  source text,
  status app.lead_status not null default 'nouveau',
  user_id uuid references public.users (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.leads (email);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  mode app.audit_mode not null default 'rapide',
  status app.audit_status not null default 'brouillon',
  last_calculation_run_id uuid,
  -- Jeton d'accès anonyme (haché) pour reprendre un audit avant création du compte.
  anonymous_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_id is not null or lead_id is not null or anonymous_token_hash is not null)
);
create index on public.audits (company_id);

create or replace function app.audit_company(aid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.company_id from public.audits a where a.id = aid
$$;


create table public.questionnaire_answers (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  questionnaire_version text not null,
  step text not null,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'brouillon' check (status in ('brouillon', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, questionnaire_version, step)
);

create table public.yearly_company_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  average_headcount numeric(8,2) check (average_headcount >= 0),
  payroll_mass numeric(14,2) check (payroll_mass >= 0),
  declared_general_reduction numeric(14,2) check (declared_general_reduction >= 0),
  source text not null default 'declaratif',
  unique (company_id, year)
);

create table public.salary_brackets (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  year int not null,
  bracket text not null check (bracket in ('lt_1_1','1_1_1_3','1_3_1_6','1_6_2','2_2_5','2_5_3','gt_3')),
  employee_count int not null check (employee_count >= 0),
  part_time_share numeric(5,4) not null default 0 check (part_time_share between 0 and 1),
  part_time_average_ratio numeric(5,4) check (part_time_average_ratio > 0 and part_time_average_ratio <= 1),
  unique (audit_id, year, bracket)
);

-- Données salariés anonymisées : AUCUN nom, AUCUN NIR (minimisation RGPD).
create table public.employees_anonymized (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  establishment_id uuid,
  internal_id text not null check (length(internal_id) <= 32),
  contract_type text not null,
  entry_date date,
  work_time_ratio numeric(5,4) check (work_time_ratio > 0 and work_time_ratio <= 1),
  unique (company_id, internal_id),
  unique (id, company_id),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id)
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  year int not null,
  month int not null check (month between 1 and 12),
  gross numeric(12,2) not null check (gross >= 0),
  hours_paid numeric(8,2) not null check (hours_paid >= 0),
  overtime_hours numeric(8,2) not null default 0 check (overtime_hours >= 0),
  reduction_applied numeric(12,2) not null default 0,
  validated boolean not null default false,
  source_extracted_field_id uuid,
  unique (employee_id, year, month),
  foreign key (employee_id, company_id) references public.employees_anonymized (id, company_id) on delete cascade
);

create table public.establishment_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  establishment_id uuid not null,
  year int not null,
  notified_rate numeric(7,5),
  applied_rate numeric(7,5),
  source text,
  source_document_id uuid,
  unique (establishment_id, year),
  foreign key (establishment_id, company_id) references public.establishments (id, company_id) on delete cascade
);

create table public.apprenticeship_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_internal_id text,
  contract_type text not null check (contract_type in ('apprentissage', 'professionnalisation')),
  start_date date not null,
  duration_months int check (duration_months > 0),
  diploma text,
  aid_received app.aid_received not null default 'inconnu',
  aid_amount_received numeric(12,2)
);

create table public.existing_schemes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  year int,
  scheme text not null check (scheme in ('interessement','participation','pee','abondement','ppv','titres_restaurant')),
  active boolean not null,
  amounts jsonb not null default '{}'::jsonb
);

-- -----------------------------------------------------------------------------
-- Documents et extraction
-- -----------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  uploaded_by uuid references public.users (id) on delete set null,
  storage_path text not null unique, -- bucket privé, URL signées courtes
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  document_type text, -- dsn, bulletin, journal_paie, notification_at, contrat_apprentissage, justificatif_aide, liasse_fiscale, justificatif_remboursement
  year int,
  establishment_id uuid,
  status app.document_status not null default 'recu',
  antivirus_status text not null default 'non_disponible',
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

create table public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  field_key text not null,
  value jsonb not null,
  page int,
  zone jsonb,
  confidence numeric(4,3) check (confidence between 0 and 1),
  extractor text not null, -- ex. « regles:dsn-v1 », « ia:<fournisseur>:<modele> »
  status app.field_status not null default 'a_valider',
  validated_by uuid references public.users (id),
  validated_at timestamptz,
  corrected_value jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_id, company_id) references public.documents (id, company_id) on delete cascade,
  check (status not in ('valide', 'corrige') or (validated_by is not null and validated_at is not null))
);

-- -----------------------------------------------------------------------------
-- Moteur : modules, paramètres, zonages, règles de cumul
-- -----------------------------------------------------------------------------
create table public.modules (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('retroactif', 'futur', 'mixte')),
  current_version text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.regulatory_parameters (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text not null,
  value numeric,
  unit text not null,
  valid_from date not null,
  valid_to date,
  territory text not null default 'FR',
  module_id text references public.modules (id),
  source_url text,
  verified_at date,
  version int not null default 1 check (version >= 1),
  status app.parameter_status not null default 'a_renseigner',
  dataset app.parameter_dataset not null default 'officiel',
  author_id uuid references public.users (id),
  validator_id uuid references public.users (id),
  published_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (status in ('a_renseigner') or value is not null),
  check (status not in ('valide', 'publie') or (source_url is not null and verified_at is not null and validator_id is not null)),
  -- Quatre yeux : le validateur n'est jamais l'auteur.
  check (validator_id is null or author_id is null or validator_id <> author_id),
  unique (key, dataset, territory, valid_from, version)
);
create index on public.regulatory_parameters (key, dataset, territory, status);

create table public.zoning_entries (
  id uuid primary key default gen_random_uuid(),
  zone_type text not null, -- ex. zrr, frr, qpv, zfu
  insee_code text not null,
  commune_name text,
  valid_from date not null,
  valid_to date,
  source_url text not null, -- aucune commune n'est classée sans source
  source_label text not null,
  imported_by uuid references public.users (id),
  imported_at timestamptz not null default now(),
  version int not null default 1,
  unique (zone_type, insee_code, valid_from, version)
);

create table public.cumulation_rules (
  id uuid primary key default gen_random_uuid(),
  assiette_prefix text not null,
  module_a text not null references public.modules (id),
  module_b text not null references public.modules (id),
  description text not null,
  source_url text not null,
  active boolean not null default true
);

create table public.reference_test_cases (
  id uuid primary key default gen_random_uuid(),
  module_id text not null references public.modules (id),
  name text not null,
  input jsonb not null,
  expected_output jsonb not null,
  dataset app.parameter_dataset not null default 'test',
  last_run_at timestamptz,
  last_run_passed boolean
);

-- -----------------------------------------------------------------------------
-- Calculs (immuables)
-- -----------------------------------------------------------------------------
create table public.calculation_runs (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  engine_version text not null,
  module_versions jsonb not null,
  dataset app.parameter_dataset not null,
  parameter_ids text[] not null,
  parameter_snapshot jsonb not null,
  frozen_input jsonb not null,
  outputs jsonb not null,
  totals jsonb not null,
  input_hash char(64) not null,
  output_hash char(64) not null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index on public.calculation_runs (audit_id);
alter table public.audits add constraint audits_last_run_fk
  foreign key (last_calculation_run_id) references public.calculation_runs (id) on delete set null;

create or replace function app.run_company(rid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.company_id from public.calculation_runs r join public.audits a on a.id = r.audit_id where r.id = rid
$$;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  calculation_run_id uuid not null references public.calculation_runs (id) on delete cascade,
  module_id text not null,
  module_version text not null,
  kind app.opportunity_kind not null,
  year int not null,
  period_from date not null,
  period_to date not null,
  -- ESTIMATION (moteur) — distincte du montant validé et du montant récupéré.
  estimated_low numeric(14,2),
  estimated_central numeric(14,2),
  estimated_high numeric(14,2),
  status app.opportunity_status not null,
  confidence app.confidence_level not null,
  risk app.risk_level not null,
  detail jsonb not null,
  -- VALIDATION (analyste)
  review_status app.review_status not null default 'a_examiner',
  validated_amount numeric(14,2),
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  review_comment text,
  check ((status = 'estime') = (estimated_central is not null)),
  check (estimated_low is null or (estimated_low <= estimated_central and estimated_central <= estimated_high)),
  check (review_status <> 'valide' or (validated_amount is not null and reviewed_by is not null))
);
create index on public.opportunities (calculation_run_id);

-- -----------------------------------------------------------------------------
-- Dossiers, mandats, remboursements, commissions
-- -----------------------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  audit_id uuid references public.audits (id),
  status app.case_status not null default 'nouveau',
  assigned_to uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);

create table public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  company_id uuid not null,
  from_status app.case_status,
  to_status app.case_status,
  event_type text not null, -- changement_statut, commentaire_interne, demande_piece, ...
  internal_only boolean not null default false,
  message text,
  actor_id uuid references public.users (id),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (case_id, company_id) references public.cases (id, company_id) on delete cascade
);

create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  commission_rate numeric(5,4) not null check (commission_rate between 0 and 1),
  terms_version text not null,
  provider text not null, -- ex. yousign
  provider_request_id text,
  status app.mandate_status not null default 'a_signer',
  signed_at timestamptz,
  signed_document_id uuid,
  created_at timestamptz not null default now(),
  foreign key (case_id, company_id) references public.cases (id, company_id) on delete cascade,
  -- Jamais de mandat « signé » sans trace du prestataire de signature.
  check (status <> 'signe' or (provider_request_id is not null and signed_at is not null and signed_document_id is not null))
);

create table public.commercial_settings (
  id int primary key default 1 check (id = 1),
  commission_rate numeric(5,4) not null default 0.25 check (commission_rate between 0 and 1),
  commission_on_future_savings boolean not null default false,
  future_savings_commission_rate numeric(5,4) check (future_savings_commission_rate between 0 and 1),
  updated_by uuid references public.users (id),
  updated_at timestamptz not null default now()
);
insert into public.commercial_settings (id) values (1);

create table public.recoveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  case_id uuid not null,
  opportunity_id uuid references public.opportunities (id),
  amount_reimbursed numeric(14,2) not null check (amount_reimbursed > 0),
  received_on date not null,
  proof_document_id uuid not null,
  recorded_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  foreign key (case_id, company_id) references public.cases (id, company_id),
  foreign key (proof_document_id, company_id) references public.documents (id, company_id)
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  recovery_id uuid not null unique references public.recoveries (id),
  rate numeric(5,4) not null,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'facturable' check (status in ('facturable', 'facturee', 'payee', 'annulee')),
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_id text,
  company_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Triggers métier
-- =============================================================================

-- updated_at
create trigger t_users_touch before update on public.users for each row execute function app.touch_updated_at();
create trigger t_companies_touch before update on public.companies for each row execute function app.touch_updated_at();
create trigger t_establishments_touch before update on public.establishments for each row execute function app.touch_updated_at();
create trigger t_audits_touch before update on public.audits for each row execute function app.touch_updated_at();
create trigger t_qa_touch before update on public.questionnaire_answers for each row execute function app.touch_updated_at();
create trigger t_cases_touch before update on public.cases for each row execute function app.touch_updated_at();

-- Création du profil à l'inscription (lien magique Supabase).
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
create trigger t_auth_user_created after insert on auth.users for each row execute function app.handle_new_auth_user();

-- Un utilisateur ne peut pas s'attribuer un rôle interne.
create or replace function app.guard_internal_role() returns trigger language plpgsql as $$
begin
  if new.internal_role is distinct from old.internal_role and not (app.is_admin() or app.is_service()) then
    raise exception 'Seul un administrateur peut modifier un rôle interne' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_users_guard before update on public.users for each row execute function app.guard_internal_role();

-- Journal générique des actions sensibles.
create or replace function app.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (actor_id, action, table_name, row_id, company_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name, r->>'id',
          nullif(r->>'company_id', '')::uuid,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger t_log_members after insert or update or delete on public.company_members for each row execute function app.log_change();
create trigger t_log_params after insert or update on public.regulatory_parameters for each row execute function app.log_change();
create trigger t_log_mandates after insert or update on public.mandates for each row execute function app.log_change();
create trigger t_log_recoveries after insert or update or delete on public.recoveries for each row execute function app.log_change();
create trigger t_log_commissions after insert or update on public.commissions for each row execute function app.log_change();
create trigger t_log_settings after update on public.commercial_settings for each row execute function app.log_change();
create trigger t_log_users after update on public.users for each row execute function app.log_change();

-- audit_logs et calculation_runs : ajout uniquement.
create or replace function app.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'La table % est en ajout seul', tg_table_name using errcode = '42501';
end $$;
create trigger t_audit_logs_immutable before update or delete on public.audit_logs for each row execute function app.forbid_mutation();
create trigger t_runs_immutable before update on public.calculation_runs for each row execute function app.forbid_mutation();

-- Les champs d'estimation d'une opportunité sont figés (seule la revue est modifiable).
create or replace function app.guard_opportunity() returns trigger language plpgsql as $$
begin
  if (new.calculation_run_id, new.module_id, new.module_version, new.kind, new.year, new.estimated_low,
      new.estimated_central, new.estimated_high, new.status, new.detail)
     is distinct from
     (old.calculation_run_id, old.module_id, old.module_version, old.kind, old.year, old.estimated_low,
      old.estimated_central, old.estimated_high, old.status, old.detail) then
    raise exception 'Les montants estimés d''une opportunité sont immuables' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_opportunity_guard before update on public.opportunities for each row execute function app.guard_opportunity();

-- Paramètres réglementaires : pas d'écrasement, cycle de vie contrôlé, quatre yeux.
create or replace function app.guard_parameter() returns trigger language plpgsql as $$
declare
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('a_renseigner', 'brouillon') and not app.is_service() then
      raise exception 'Un paramètre est créé au statut a_renseigner ou brouillon' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Contenu modifiable uniquement avant validation.
  if old.status not in ('a_renseigner', 'brouillon') and
     (new.key, new.value, new.unit, new.valid_from, new.valid_to, new.territory, new.dataset, new.version, new.source_url)
     is distinct from
     (old.key, old.value, old.unit, old.valid_from, old.valid_to, old.territory, old.dataset, old.version, old.source_url) then
    raise exception 'Paramètre % validé : toute modification doit créer une nouvelle version', old.id using errcode = '42501';
  end if;

  allowed := (old.status, new.status) in (
    ('a_renseigner', 'a_renseigner'), ('a_renseigner', 'brouillon'), ('brouillon', 'brouillon'),
    ('brouillon', 'a_renseigner'), ('brouillon', 'valide'), ('valide', 'brouillon'),
    ('valide', 'publie'), ('publie', 'archive'), ('valide', 'archive'), ('brouillon', 'archive'),
    ('valide', 'valide'), ('publie', 'publie'), ('archive', 'archive'));
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
    -- La nouvelle version publiée remplace (archive) les versions publiées qui la chevauchent.
    update public.regulatory_parameters p set status = 'archive'
     where p.id <> new.id and p.key = new.key and p.dataset = new.dataset and p.territory = new.territory
       and p.status = 'publie'
       and p.valid_from <= coalesce(new.valid_to, 'infinity'::date)
       and coalesce(p.valid_to, 'infinity'::date) >= new.valid_from;
  end if;
  return new;
end $$;
create trigger t_parameter_guard before insert or update on public.regulatory_parameters for each row execute function app.guard_parameter();
create or replace function app.forbid_delete() returns trigger language plpgsql as $$
begin raise exception 'Suppression interdite sur %', tg_table_name using errcode = '42501'; end $$;
create trigger t_parameter_nodelete before delete on public.regulatory_parameters for each row execute function app.forbid_delete();

-- Dossiers : chaque changement de statut est horodaté et journalisé.
create or replace function app.case_status_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.case_events (case_id, company_id, from_status, to_status, event_type, actor_id)
    values (new.id, new.company_id, case when tg_op = 'UPDATE' then old.status end, new.status, 'changement_statut', auth.uid());
  end if;
  return new;
end $$;
create trigger t_case_status after insert or update on public.cases for each row execute function app.case_status_event();

-- Remboursements : saisis par un administrateur, avec justificatif ; la commission est
-- calculée automatiquement, uniquement à partir d'un remboursement réel.
create or replace function app.guard_recovery() returns trigger language plpgsql as $$
begin
  if not (app.is_admin() or app.is_service()) then
    raise exception 'Seul un administrateur peut enregistrer un remboursement' using errcode = '42501';
  end if;
  if not app.is_service() then new.recorded_by := auth.uid(); end if;
  return new;
end $$;
create trigger t_recovery_guard before insert or update on public.recoveries for each row execute function app.guard_recovery();

create or replace function app.create_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r numeric;
begin
  select s.commission_rate into r from public.commercial_settings s where s.id = 1;
  insert into public.commissions (company_id, recovery_id, rate, amount)
  values (new.company_id, new.id, r, round(new.amount_reimbursed * r, 2));
  return new;
end $$;
create trigger t_recovery_commission after insert on public.recoveries for each row execute function app.create_commission();

create or replace function app.guard_commission() returns trigger language plpgsql as $$
begin
  -- Les commissions ne sont créées que par le trigger de remboursement.
  if tg_op = 'INSERT' and pg_trigger_depth() < 2 then
    raise exception 'Une commission ne peut être créée qu''à partir d''un remboursement réel' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.amount, new.rate, new.recovery_id) is distinct from (old.amount, old.rate, old.recovery_id) then
    raise exception 'Montant de commission immuable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_commission_guard before insert or update on public.commissions for each row execute function app.guard_commission();

-- Création d'entreprise : l'appelant en devient propriétaire, de façon atomique.
create or replace function app.create_company(p_siren text, p_legal_name text, p_legal_form text default null,
  p_naf_code text default null, p_sector text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise' using errcode = '42501'; end if;
  insert into public.companies (siren, legal_name, legal_form, naf_code, sector)
  values (p_siren, p_legal_name, p_legal_form, p_naf_code, p_sector) returning id into cid;
  insert into public.company_members (user_id, company_id, role) values (auth.uid(), cid, 'proprietaire');
  return cid;
end $$;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'users','companies','company_members','invitations','establishments','leads','audits','questionnaire_answers',
    'yearly_company_data','salary_brackets','employees_anonymized','payroll_lines','establishment_rates',
    'apprenticeship_contracts','existing_schemes','documents','extracted_fields','modules','regulatory_parameters',
    'zoning_entries','cumulation_rules','reference_test_cases','calculation_runs','opportunities','cases',
    'case_events','mandates','commercial_settings','recoveries','commissions','notifications','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Tables portant directement company_id : lecture membres + internes, écriture propriétaire/collaborateur + internes.
do $$
declare t text;
begin
  foreach t in array array['establishments','yearly_company_data','employees_anonymized','payroll_lines',
                           'establishment_rates','apprenticeship_contracts','existing_schemes']
  loop
    execute format('create policy p_select on public.%I for select to authenticated using (app.is_company_member(company_id) or app.is_internal())', t);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (app.can_write_company(company_id) or app.is_internal())', t);
    execute format('create policy p_update on public.%I for update to authenticated using (app.can_write_company(company_id) or app.is_internal()) with check (app.can_write_company(company_id) or app.is_internal())', t);
    execute format('create policy p_delete on public.%I for delete to authenticated using (app.can_write_company(company_id) or app.is_admin())', t);
  end loop;
end $$;

-- users
create policy p_select on public.users for select to authenticated using (id = auth.uid() or app.is_internal());
create policy p_update on public.users for update to authenticated using (id = auth.uid() or app.is_admin()) with check (id = auth.uid() or app.is_admin());

-- companies (création via app.create_company)
create policy p_select on public.companies for select to authenticated using (app.is_company_member(id) or app.is_internal());
create policy p_update on public.companies for update to authenticated using (app.can_write_company(id) or app.is_internal()) with check (app.can_write_company(id) or app.is_internal());

-- company_members : le propriétaire gère les membres ; chacun voit les membres de ses entreprises.
create policy p_select on public.company_members for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.company_members for insert to authenticated with check (app.company_role(company_id) = 'proprietaire' or app.is_admin());
create policy p_update on public.company_members for update to authenticated using (app.company_role(company_id) = 'proprietaire' or app.is_admin()) with check (app.company_role(company_id) = 'proprietaire' or app.is_admin());
create policy p_delete on public.company_members for delete to authenticated using (app.company_role(company_id) = 'proprietaire' or user_id = auth.uid() or app.is_admin());

-- invitations
create policy p_all on public.invitations for all to authenticated
  using (app.company_role(company_id) = 'proprietaire' or app.is_admin())
  with check (app.company_role(company_id) = 'proprietaire' or app.is_admin());

-- leads : internes uniquement (créés par action serveur).
create policy p_select on public.leads for select to authenticated using (app.is_internal());
create policy p_update on public.leads for update to authenticated using (app.is_internal()) with check (app.is_internal());

-- audits et tables rattachées à un audit
create policy p_select on public.audits for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.audits for insert to authenticated with check (app.can_write_company(company_id) or app.is_internal());
create policy p_update on public.audits for update to authenticated using (app.can_write_company(company_id) or app.is_internal()) with check (app.can_write_company(company_id) or app.is_internal());

do $$
declare t text;
begin
  foreach t in array array['questionnaire_answers','salary_brackets']
  loop
    execute format('create policy p_select on public.%I for select to authenticated using (app.is_company_member(app.audit_company(audit_id)) or app.is_internal())', t);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (app.can_write_company(app.audit_company(audit_id)) or app.is_internal())', t);
    execute format('create policy p_update on public.%I for update to authenticated using (app.can_write_company(app.audit_company(audit_id)) or app.is_internal()) with check (app.can_write_company(app.audit_company(audit_id)) or app.is_internal())', t);
    execute format('create policy p_delete on public.%I for delete to authenticated using (app.can_write_company(app.audit_company(audit_id)) or app.is_internal())', t);
  end loop;
end $$;

-- calculation_runs / opportunities : écrits par le serveur (service_role), lus par les membres.
create policy p_select on public.calculation_runs for select to authenticated using (app.is_company_member(app.audit_company(audit_id)) or app.is_internal());
create policy p_select on public.opportunities for select to authenticated using (app.is_company_member(app.run_company(calculation_run_id)) or app.is_internal());
create policy p_review on public.opportunities for update to authenticated using (app.is_internal()) with check (app.is_internal());

-- documents : dépôt possible pour tout membre (y compris comptable invité).
create policy p_select on public.documents for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.documents for insert to authenticated with check (app.can_upload_company(company_id) or app.is_internal());
create policy p_update on public.documents for update to authenticated using (app.is_internal()) with check (app.is_internal());

create policy p_select on public.extracted_fields for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_update on public.extracted_fields for update to authenticated using (app.can_write_company(company_id) or app.is_internal()) with check (app.can_write_company(company_id) or app.is_internal());

-- référentiel moteur : lecture interne, écriture administrateur (paramètres : interne).
create policy p_select on public.modules for select to authenticated using (app.is_internal());
create policy p_write on public.modules for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy p_select on public.regulatory_parameters for select to authenticated using (app.is_internal());
create policy p_insert on public.regulatory_parameters for insert to authenticated with check (app.is_admin() and author_id = auth.uid());
create policy p_update on public.regulatory_parameters for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy p_select on public.zoning_entries for select to authenticated using (app.is_internal());
create policy p_write on public.zoning_entries for insert to authenticated with check (app.is_admin());
create policy p_select on public.cumulation_rules for select to authenticated using (app.is_internal());
create policy p_write on public.cumulation_rules for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy p_select on public.reference_test_cases for select to authenticated using (app.is_internal());
create policy p_write on public.reference_test_cases for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- dossiers
create policy p_select on public.cases for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.cases for insert to authenticated with check (app.can_write_company(company_id) or app.is_internal());
create policy p_update on public.cases for update to authenticated using (app.is_internal()) with check (app.is_internal());
create policy p_select on public.case_events for select to authenticated using ((app.is_company_member(company_id) and not internal_only) or app.is_internal());
create policy p_insert on public.case_events for insert to authenticated with check (app.is_internal());

create policy p_select on public.mandates for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.mandates for insert to authenticated with check (app.company_role(company_id) = 'proprietaire' or app.is_internal());

create policy p_select on public.commercial_settings for select to authenticated using (true);
create policy p_update on public.commercial_settings for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy p_select on public.recoveries for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_insert on public.recoveries for insert to authenticated with check (app.is_admin());
create policy p_select on public.commissions for select to authenticated using (app.is_company_member(company_id) or app.is_internal());
create policy p_update on public.commissions for update to authenticated using (app.is_admin()) with check (app.is_admin());

create policy p_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy p_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy p_select on public.audit_logs for select to authenticated using (app.is_admin());

-- Droits d'exécution des fonctions d'autorisation.
grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.create_company(text, text, text, text, text) from anon;
