-- =============================================================================
-- Phase 6 – Mode avancé, import documentaire, extraction, validation
-- =============================================================================

-- Documents : classification, statut détaillé, erreurs, rattachement facultatif à un audit.
alter type app.document_status add value if not exists 'extraction_manuelle';
alter table public.documents
  add column audit_id uuid references public.audits (id) on delete set null,
  add column classification_confidence numeric(4,3),
  add column processing_notes jsonb not null default '[]'::jsonb,
  add column processed_at timestamptz,
  add constraint documents_size_limit check (size_bytes <= 20 * 1024 * 1024),
  add constraint documents_mime check (mime_type in ('application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'));
create unique index documents_company_sha on public.documents (company_id, sha256);

-- Champs extraits : clé fonctionnelle, valeur, provenance (page/ligne), confiance, validation.
alter table public.extracted_fields
  add column year int,
  add column establishment_id uuid references public.establishments (id),
  add column applied_at timestamptz,
  add constraint extracted_fields_key check (field_key in ('ligne_paie', 'taux_at_notifie', 'type_document'));
create index extracted_fields_document on public.extracted_fields (document_id);
create index extracted_fields_pending on public.extracted_fields (company_id) where status = 'a_valider';

-- Le comptable invité dépose mais ne valide pas : validation réservée à l'écriture (déjà le cas
-- via app.can_write_company) ; on interdit en plus de modifier la valeur extraite d'origine.
create or replace function app.guard_extracted_field() returns trigger language plpgsql as $$
begin
  if (new.document_id, new.field_key, new.value, new.page, new.zone, new.confidence, new.extractor)
     is distinct from (old.document_id, old.field_key, old.value, old.page, old.zone, old.confidence, old.extractor) then
    raise exception 'La valeur extraite d''origine est immuable : utilisez corrected_value' using errcode = '42501';
  end if;
  if new.status in ('valide', 'corrige') and old.status not in ('valide', 'corrige') and not app.is_service() then
    new.validated_by := auth.uid();
    new.validated_at := now();
  end if;
  if new.status = 'corrige' and new.corrected_value is null then
    raise exception 'Une correction exige une valeur corrigée' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger t_extracted_field_guard before update on public.extracted_fields for each row execute function app.guard_extracted_field();

-- Lignes de paie : une ligne issue d'un champ extrait n'est utilisable qu'une fois ce champ validé.
alter table public.payroll_lines
  add column source text not null default 'saisie_manuelle' check (source in ('saisie_manuelle', 'extraction')),
  add constraint payroll_lines_source_field foreign key (source_extracted_field_id) references public.extracted_fields (id) on delete set null;

-- File de traitement asynchrone (extraction documentaire), réservée au serveur.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('extraire_document')),
  payload jsonb not null,
  status text not null default 'en_attente' check (status in ('en_attente', 'en_cours', 'termine', 'echec')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_pending on public.jobs (run_after) where status = 'en_attente';
alter table public.jobs enable row level security;
alter table public.jobs force row level security;
create policy p_select on public.jobs for select to authenticated using (app.is_internal());

-- Audit avancé : les réponses du mode rapide sont reprises (aucune perte).
alter table public.audits add column source_audit_id uuid references public.audits (id) on delete set null;

grant execute on all functions in schema app to authenticated, service_role;
