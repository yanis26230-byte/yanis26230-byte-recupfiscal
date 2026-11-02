-- Socle minimal reproduisant Supabase pour les tests et le développement local (PGlite).
-- N'est JAMAIS appliqué sur un vrai projet Supabase, qui fournit déjà ces objets.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Stockage (sous-ensemble de Supabase Storage) : tables et RLS, pour tester les politiques.
create schema storage;
create table storage.buckets (id text primary key, name text not null unique, public boolean not null default false, created_at timestamptz not null default now());
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
