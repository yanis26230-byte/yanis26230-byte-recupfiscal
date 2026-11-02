-- =============================================================================
-- Phase 8 – Conversion : dossiers, mandats, justificatifs, remboursements, notifications
-- =============================================================================

alter table public.companies add column verified_by uuid references public.users (id), add column verified_at timestamptz;

alter table public.cases
  add column opened_by uuid references public.users (id),
  add column title text;
create unique index cases_one_open_per_audit on public.cases (audit_id) where status not in ('cloture', 'refuse');

alter table public.documents add column case_id uuid references public.cases (id) on delete set null;
alter table public.documents drop constraint documents_mime;
alter table public.documents add constraint documents_mime check (mime_type in ('application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'));

alter table public.mandates
  add column signer_first_name text,
  add column signer_last_name text,
  add column signer_email text,
  add column signer_function text,
  add column declaration_accepted_at timestamptz,
  add column terms_text_id uuid references public.commercial_texts (id),
  add column unsigned_document_id uuid references public.documents (id),
  add column provider_status text,
  add column updated_at timestamptz not null default now(),
  add constraint mandates_provider check (provider in ('yousign', 'desactive'));
-- Un mandat signé est figé (taux, conditions, signataire).
create or replace function app.guard_mandate() returns trigger language plpgsql as $$
begin
  if old.status = 'signe' and (new.status, new.commission_rate, new.terms_version, new.signed_document_id, new.signer_email)
     is distinct from (old.status, old.commission_rate, old.terms_version, old.signed_document_id, old.signer_email) then
    raise exception 'Mandat signé : non modifiable' using errcode = '42501';
  end if;
  if new.commission_rate is distinct from old.commission_rate or new.terms_version is distinct from old.terms_version then
    raise exception 'Taux et conditions d''un mandat figés à sa création' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger t_mandate_guard before update on public.mandates for each row execute function app.guard_mandate();

-- Cycle de vie d'un dossier : transitions autorisées et préconditions.
create or replace function app.guard_case_transition() returns trigger language plpgsql as $$
declare
  ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := (old.status, new.status) in (
    ('nouveau', 'informations_manquantes'), ('nouveau', 'en_analyse'),
    ('informations_manquantes', 'en_analyse'),
    ('en_analyse', 'informations_manquantes'), ('en_analyse', 'a_valider_expert'),
    ('a_valider_expert', 'en_analyse'), ('a_valider_expert', 'pret_a_deposer'),
    ('pret_a_deposer', 'depose'), ('depose', 'en_attente_reponse'),
    ('en_attente_reponse', 'accepte'), ('en_attente_reponse', 'refuse'),
    ('accepte', 'rembourse'), ('refuse', 'cloture'), ('rembourse', 'cloture'))
    or (new.status = 'cloture' and old.status not in ('cloture'));
  if not ok then
    raise exception 'Transition de dossier interdite : % -> %', old.status, new.status using errcode = '42501';
  end if;
  if new.status = 'depose' then
    if not exists (select 1 from public.mandates m where m.case_id = new.id and m.status = 'signe') then
      raise exception 'Dépôt impossible : aucun mandat signé' using errcode = '42501';
    end if;
    if not exists (select 1 from public.companies c where c.id = new.company_id and c.verification_status = 'verifiee') then
      raise exception 'Dépôt impossible : entreprise non vérifiée' using errcode = '42501';
    end if;
  end if;
  if new.status = 'rembourse' and not exists (select 1 from public.recoveries r where r.case_id = new.id) then
    raise exception 'Statut « remboursé » impossible sans remboursement enregistré' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_case_transition before update on public.cases for each row execute function app.guard_case_transition();

-- Événements visibles du client : demandes de pièces et messages ; commentaires internes masqués (RLS existante).
create policy p_insert_client on public.case_events for insert to authenticated
  with check (app.can_write_company(company_id) and not internal_only and event_type = 'message_client' and actor_id = auth.uid());

-- Commissions : suivi de facturation par un administrateur.
create or replace function app.guard_commission_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if (old.status, new.status) not in (('facturable', 'facturee'), ('facturee', 'payee'), ('facturable', 'annulee'), ('facturee', 'annulee')) then
      raise exception 'Transition de commission interdite' using errcode = '42501';
    end if;
    if new.status = 'facturee' then new.invoiced_at := now(); end if;
    if new.status = 'payee' then new.paid_at := now(); end if;
  end if;
  return new;
end $$;
create trigger t_commission_status before update on public.commissions for each row execute function app.guard_commission_status();

-- Notifications : lecture et marquage par leur destinataire (politiques existantes) ; création par le serveur.
create index notifications_user on public.notifications (user_id, created_at desc);

grant execute on all functions in schema app to authenticated, service_role;

-- La commission suit le taux figé dans le mandat signé du dossier (à défaut, le taux en vigueur).
create or replace function app.create_commission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r numeric;
begin
  select m.commission_rate into r from public.mandates m where m.case_id = new.case_id and m.status = 'signe' order by m.signed_at desc limit 1;
  if r is null then select s.commission_rate into r from public.commercial_settings s where s.id = 1; end if;
  insert into public.commissions (company_id, recovery_id, rate, amount)
  values (new.company_id, new.id, r, round(new.amount_reimbursed * r, 2));
  return new;
end $$;
