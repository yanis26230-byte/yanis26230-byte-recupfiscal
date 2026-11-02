-- =============================================================================
-- Phase 9 – Sécurité et RGPD
-- =============================================================================

-- Limitation de débit des actions publiques (fenêtre fixe), réservée au serveur.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

-- Demandes RGPD (export, suppression) : traçabilité de la réponse.
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('export', 'suppression')),
  user_email_hash char(64) not null,
  status text not null check (status in ('effectuee', 'refusee')),
  details text,
  created_at timestamptz not null default now()
);
alter table public.privacy_requests enable row level security;
alter table public.privacy_requests force row level security;
create policy p_select on public.privacy_requests for select to authenticated using (app.is_admin());

-- Droit à l'effacement : toute référence à un utilisateur devient NULL à la suppression du compte
-- (traçabilité conservée sans donnée personnelle).
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.users'::regclass and c.confdeltype = 'a' and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s alter column %I drop not null', r.tbl, r.col);
    execute format('alter table %s add constraint %I foreign key (%I) references public.users (id) on delete set null', r.tbl, r.conname, r.col);
  end loop;
end $$;

-- Un champ validé reste validé si son validateur supprime son compte (la date est conservée).
alter table public.extracted_fields drop constraint extracted_fields_check;
alter table public.extracted_fields add constraint extracted_fields_validated_at check (status not in ('valide', 'corrige') or validated_at is not null);
