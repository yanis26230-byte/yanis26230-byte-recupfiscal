-- =============================================================================
-- Phase 3 – Audits anonymes du mode rapide
-- =============================================================================

-- Jeu de paramètres utilisé par l'audit : « test » réservé aux démonstrations (Boulangerie Démo).
alter table public.audits
  add column parameter_dataset app.parameter_dataset not null default 'officiel',
  add column is_demo boolean not null default false,
  add column submitted_at timestamptz,
  add constraint audits_test_dataset_only_for_demo check (parameter_dataset = 'officiel' or is_demo);

create index audits_lead on public.audits (lead_id);
create index leads_created on public.leads (created_at desc);

-- Prospect : un même e-mail peut revenir avec plusieurs audits ; on garde chaque saisie.
alter table public.leads
  add column honeypot_triggered boolean not null default false,
  add constraint leads_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- -----------------------------------------------------------------------------
-- Jeu « test » (démonstration, valeurs fictives) : chargé par le serveur (rôle service)
-- sans circuit de validation. Le jeu « officiel » reste soumis aux quatre yeux, sans exception,
-- et un utilisateur (même administrateur) reste soumis aux gardes y compris pour le jeu test.
-- -----------------------------------------------------------------------------
alter table public.regulatory_parameters drop constraint regulatory_parameters_check2;
alter table public.regulatory_parameters add constraint regulatory_parameters_published_requirements
  check (status not in ('valide', 'publie') or (source_url is not null and verified_at is not null and (validator_id is not null or dataset = 'test')));
alter table public.zoning_datasets drop constraint zoning_datasets_check2;
alter table public.zoning_datasets add constraint zoning_datasets_published_requirements
  check (status not in ('valide', 'publie') or validator_id is not null or dataset = 'test');
alter table public.zone_schemes drop constraint zone_schemes_check1;
alter table public.zone_schemes add constraint zone_schemes_published_requirements
  check (status not in ('valide', 'publie') or (source_url is not null and (validator_id is not null or dataset = 'test')));

drop trigger t_parameter_guard on public.regulatory_parameters;
create trigger t_parameter_guard before insert or update on public.regulatory_parameters
  for each row when (new.dataset = 'officiel' or not app.is_service()) execute function app.guard_parameter();
drop trigger t_zoning_datasets_guard on public.zoning_datasets;
create trigger t_zoning_datasets_guard before insert or update on public.zoning_datasets
  for each row when (new.dataset = 'officiel' or not app.is_service()) execute function app.guard_reference_lifecycle();
drop trigger t_zone_schemes_guard on public.zone_schemes;
create trigger t_zone_schemes_guard before insert or update on public.zone_schemes
  for each row when (new.dataset = 'officiel' or not app.is_service()) execute function app.guard_reference_lifecycle();
