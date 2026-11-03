-- =============================================================================
-- Antivirus : un fichier infecté n'est jamais enregistré ; statut de l'analyse conservé.
-- =============================================================================
alter table public.documents add constraint documents_antivirus_status check (antivirus_status in ('sain', 'non_disponible'));
