-- Authentification LOCALE (développement et tests uniquement, interdite en production).
-- En production, l'authentification est assurée par Supabase Auth (lien magique).
-- Schéma non exposé : accessible uniquement par le serveur.
create schema local_auth;
create table local_auth.magic_links (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  next_path text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index magic_links_email on local_auth.magic_links (lower(email), created_at desc);
create table local_auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- Boîte d'envoi de développement : les e-mails y sont déposés au lieu d'être envoyés.
create table local_auth.outbox (
  id bigint generated always as identity primary key,
  to_email text not null,
  subject text not null,
  text_body text not null,
  html_body text,
  created_at timestamptz not null default now()
);
revoke all on schema local_auth from anon, authenticated;
