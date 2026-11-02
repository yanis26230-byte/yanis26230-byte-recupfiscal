-- =============================================================================
-- Phase 7 – Back-office
-- =============================================================================

-- Textes contractuels et e-mails automatiques, versionnés (jamais écrasés).
create table public.commercial_texts (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('conditions_mandat', 'email_statut_dossier', 'email_invitation', 'email_lien_connexion')),
  version int not null check (version >= 1),
  title text not null,
  body text not null check (length(body) between 10 and 50000),
  active boolean not null default false,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (key, version)
);
create unique index commercial_texts_one_active on public.commercial_texts (key) where active;
alter table public.commercial_texts enable row level security;
alter table public.commercial_texts force row level security;
-- Lecture par tous les utilisateurs connectés (le client lit les conditions qu'il accepte).
create policy p_select on public.commercial_texts for select to authenticated using (active or app.is_internal());
create policy p_insert on public.commercial_texts for insert to authenticated with check (app.is_admin() and created_by = auth.uid());
create policy p_update on public.commercial_texts for update to authenticated using (app.is_admin()) with check (app.is_admin());
create or replace function app.guard_commercial_text() returns trigger language plpgsql as $$
begin
  if (new.key, new.version, new.title, new.body) is distinct from (old.key, old.version, old.title, old.body) then
    raise exception 'Texte versionné : créez une nouvelle version' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_commercial_text_guard before update on public.commercial_texts for each row execute function app.guard_commercial_text();
create trigger t_log_commercial_texts after insert or update on public.commercial_texts for each row execute function app.log_change();

-- Résultat détaillé de la dernière exécution des cas de référence.
alter table public.reference_test_cases add column last_run_details jsonb;

-- Revue d'une opportunité : l'auteur de la revue est toujours l'utilisateur courant.
create or replace function app.stamp_review() returns trigger language plpgsql as $$
begin
  if new.review_status is distinct from old.review_status or new.validated_amount is distinct from old.validated_amount then
    if not app.is_service() then new.reviewed_by := auth.uid(); end if;
    new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger t_opportunity_review before update on public.opportunities for each row execute function app.stamp_review();
create trigger t_log_opportunity_review after update on public.opportunities for each row execute function app.log_change();

grant execute on all functions in schema app to authenticated, service_role;
