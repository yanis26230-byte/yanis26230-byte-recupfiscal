-- =============================================================================
-- Phase 4 – Comptes, rattachement des audits, membres et invitations, stockage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audits rattachés à un utilisateur (avant ou sans entreprise vérifiée)
-- -----------------------------------------------------------------------------
alter table public.audits add column owner_user_id uuid references public.users (id) on delete set null;
create index audits_owner on public.audits (owner_user_id);
alter table public.audits drop constraint audits_check;
alter table public.audits add constraint audits_has_holder
  check (company_id is not null or owner_user_id is not null or lead_id is not null or anonymous_token_hash is not null);

-- Vérification de l'entreprise (rattachement déclaratif à la création ; vérifiée avant tout mandat).
alter table public.companies
  add column verification_status text not null default 'non_verifiee' check (verification_status in ('non_verifiee', 'verifiee', 'rejetee')),
  add column created_by uuid references public.users (id);

-- Lecture et écriture d'un audit : membre de l'entreprise, propriétaire personnel, ou interne.
create or replace function app.can_read_audit(aid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.audits a
     where a.id = aid
       and (a.owner_user_id = auth.uid()
            or (a.company_id is not null and exists (select 1 from public.company_members m where m.company_id = a.company_id and m.user_id = auth.uid())))
  ) or app.is_internal()
$$;

create or replace function app.can_write_audit(aid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.audits a
     where a.id = aid
       and (a.owner_user_id = auth.uid()
            or (a.company_id is not null and exists (select 1 from public.company_members m where m.company_id = a.company_id and m.user_id = auth.uid()
                                                     and m.role in ('proprietaire', 'collaborateur'))))
  ) or app.is_internal()
$$;

drop policy p_select on public.audits;
drop policy p_insert on public.audits;
drop policy p_update on public.audits;
create policy p_select on public.audits for select to authenticated
  using (owner_user_id = auth.uid() or app.is_company_member(company_id) or app.is_internal());
-- Un audit est soit personnel (owner = soi), soit d'entreprise (droit d'écriture) ; jamais au nom d'un autre utilisateur.
create policy p_insert on public.audits for insert to authenticated
  with check (
    (owner_user_id is null or owner_user_id = auth.uid())
    and ((company_id is null and owner_user_id = auth.uid()) or app.can_write_company(company_id))
    or app.is_internal());
create policy p_update on public.audits for update to authenticated
  using (owner_user_id = auth.uid() or app.can_write_company(company_id) or app.is_internal())
  with check (
    (owner_user_id is null or owner_user_id = auth.uid())
    and ((company_id is null and owner_user_id = auth.uid()) or app.can_write_company(company_id))
    or app.is_internal());

do $$
declare t text;
begin
  foreach t in array array['questionnaire_answers', 'salary_brackets']
  loop
    execute format('drop policy p_select on public.%I', t);
    execute format('drop policy p_insert on public.%I', t);
    execute format('drop policy p_update on public.%I', t);
    execute format('drop policy p_delete on public.%I', t);
    execute format('create policy p_select on public.%I for select to authenticated using (app.can_read_audit(audit_id))', t);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (app.can_write_audit(audit_id))', t);
    execute format('create policy p_update on public.%I for update to authenticated using (app.can_write_audit(audit_id)) with check (app.can_write_audit(audit_id))', t);
    execute format('create policy p_delete on public.%I for delete to authenticated using (app.can_write_audit(audit_id))', t);
  end loop;
end $$;

drop policy p_select on public.calculation_runs;
create policy p_select on public.calculation_runs for select to authenticated using (app.can_read_audit(audit_id));

create or replace function app.run_audit(rid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.audit_id from public.calculation_runs r where r.id = rid
$$;
drop policy p_select on public.opportunities;
create policy p_select on public.opportunities for select to authenticated using (app.can_read_audit(app.run_audit(calculation_run_id)));

-- -----------------------------------------------------------------------------
-- Réclamation d'un audit anonyme après vérification de l'e-mail (lien magique)
-- -----------------------------------------------------------------------------
create table public.audit_claims (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  email text not null,
  expires_at timestamptz not null,
  claimed_by uuid references public.users (id),
  claimed_at timestamptz,
  outcome text check (outcome in ('entreprise_creee', 'entreprise_existante_membre', 'entreprise_existante_non_membre', 'personnel')),
  created_at timestamptz not null default now()
);
create index audit_claims_email on public.audit_claims (lower(email)) where claimed_at is null;
alter table public.audit_claims enable row level security;
alter table public.audit_claims force row level security;
create policy p_select on public.audit_claims for select to authenticated using (claimed_by = auth.uid() or app.is_internal());

-- -----------------------------------------------------------------------------
-- Membres : jamais d'entreprise sans propriétaire
-- -----------------------------------------------------------------------------
create or replace function app.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  remaining int;
begin
  if old.role = 'proprietaire' and (tg_op = 'DELETE' or new.role <> 'proprietaire') then
    -- Suppression en cascade de l'entreprise elle-même : autorisée.
    if not exists (select 1 from public.companies c where c.id = old.company_id) then return coalesce(new, old); end if;
    select count(*) into remaining from public.company_members m
     where m.company_id = old.company_id and m.role = 'proprietaire' and m.user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Une entreprise doit conserver au moins un propriétaire' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger t_last_owner before update or delete on public.company_members for each row execute function app.guard_last_owner();

-- -----------------------------------------------------------------------------
-- Invitations : jeton haché, expiration, e-mail destinataire imposé
-- -----------------------------------------------------------------------------
alter table public.invitations
  add column revoked_at timestamptz,
  add column accepted_by uuid references public.users (id),
  add constraint invitations_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create unique index invitations_one_pending on public.invitations (company_id, lower(email)) where accepted_at is null and revoked_at is null;
create trigger t_log_invitations after insert or update on public.invitations for each row execute function app.log_change();

-- -----------------------------------------------------------------------------
-- Stockage privé des documents (Supabase Storage) : chemin « <company_id>/<fichier> »
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

create or replace function app.storage_company(object_name text) returns uuid
language plpgsql immutable as $$
declare
  first_segment text := split_part(object_name, '/', 1);
begin
  if first_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return first_segment::uuid; end if;
  return null;
end $$;

create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (app.is_company_member(app.storage_company(name)) or app.is_internal()));
create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (app.can_upload_company(app.storage_company(name)) or app.is_internal()));
-- Pas de modification ni de suppression par les clients : les documents sont des pièces justificatives.
create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and app.is_admin());

grant execute on all functions in schema app to authenticated, service_role;

-- Établissements saisis à la main sans SIRET connu (le SIRET reste unique lorsqu'il est renseigné).
alter table public.establishments alter column siret drop not null;

-- Liste des membres d'une entreprise avec leur e-mail, réservée aux membres de cette entreprise.
create or replace function app.list_company_members(cid uuid)
returns table (user_id uuid, email text, first_name text, role app.member_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email, u.first_name, m.role, m.created_at
    from public.company_members m join public.users u on u.id = m.user_id
   where m.company_id = cid and (app.is_company_member(cid) or app.is_internal())
   order by m.created_at
$$;
grant execute on function app.list_company_members(uuid) to authenticated;
