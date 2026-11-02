import { z } from 'zod';
import { headcountRangeLabel, legalFormLabel } from './legal-forms';
import { isValidSiren, looksLikeSiren, normalizeSiren } from './siren';
import { sectorFromNaf, type SectorId } from './sectors';

/**
 * Client de l'API publique Recherche d'entreprises (recherche-entreprises.api.gouv.fr,
 * sans clé). Seuls les champs nécessaires sont lus ; la réponse est validée avec Zod
 * (champs inconnus ignorés, champs absents tolérés).
 */
const etablissement = z.object({
  siret: z.string(),
  adresse: z.string().nullish(),
  code_postal: z.string().nullish(),
  commune: z.string().nullish(),
  libelle_commune: z.string().nullish(),
  est_siege: z.boolean().nullish(),
  etat_administratif: z.string().nullish(),
});

const resultat = z.object({
  siren: z.string(),
  nom_complet: z.string().nullish(),
  nom_raison_sociale: z.string().nullish(),
  nature_juridique: z.string().nullish(),
  activite_principale: z.string().nullish(),
  date_creation: z.string().nullish(),
  tranche_effectif_salarie: z.string().nullish(),
  nombre_etablissements_ouverts: z.number().nullish(),
  etat_administratif: z.string().nullish(),
  siege: etablissement.partial().nullish(),
  matching_etablissements: z.array(etablissement).nullish(),
});

const response = z.object({ results: z.array(resultat), total_results: z.number().nullish() });

export interface EstablishmentData {
  siret: string | null;
  address: string;
  postalCode: string;
  city: string;
  inseeCode: string | null;
  isHeadOffice: boolean;
}

export interface CompanyData {
  siren: string;
  legalName: string;
  legalFormCode: string | null;
  legalForm: string | null;
  nafCode: string | null;
  sector: SectorId;
  createdOn: string | null;
  headcountRangeCode: string | null;
  headcountRange: string | null;
  isActive: boolean;
  establishments: EstablishmentData[];
  /** Nombre d'établissements ouverts déclaré : peut dépasser la liste renvoyée. */
  openEstablishmentsCount: number | null;
}

export type SearchResult =
  | { ok: true; companies: CompanyData[] }
  | { ok: false; reason: 'invalid_query' | 'invalid_siren' | 'unavailable'; message: string };

function mapEstablishment(e: z.infer<typeof etablissement>): EstablishmentData {
  return {
    siret: e.siret,
    address: e.adresse ?? '',
    postalCode: e.code_postal ?? '',
    city: e.libelle_commune ?? '',
    inseeCode: e.commune ?? null,
    isHeadOffice: e.est_siege ?? false,
  };
}

export function mapCompany(r: z.infer<typeof resultat>): CompanyData {
  const establishments = new Map<string, EstablishmentData>();
  if (r.siege?.siret) establishments.set(r.siege.siret, { ...mapEstablishment({ ...r.siege, siret: r.siege.siret }), isHeadOffice: true });
  for (const e of r.matching_etablissements ?? []) {
    if (e.etat_administratif && e.etat_administratif !== 'A') continue; // établissements fermés exclus
    if (!establishments.has(e.siret)) establishments.set(e.siret, mapEstablishment(e));
  }
  return {
    siren: r.siren,
    legalName: r.nom_raison_sociale ?? r.nom_complet ?? r.siren,
    legalFormCode: r.nature_juridique ?? null,
    legalForm: legalFormLabel(r.nature_juridique),
    nafCode: r.activite_principale ?? null,
    sector: sectorFromNaf(r.activite_principale),
    createdOn: r.date_creation ?? null,
    headcountRangeCode: r.tranche_effectif_salarie ?? null,
    headcountRange: headcountRangeLabel(r.tranche_effectif_salarie),
    isActive: (r.etat_administratif ?? 'A') === 'A',
    establishments: [...establishments.values()],
    openEstablishmentsCount: r.nombre_etablissements_ouverts ?? null,
  };
}

export interface SearchOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function searchCompanies(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim();
  if (q.length < 3 || q.length > 120) return { ok: false, reason: 'invalid_query', message: 'Saisissez au moins 3 caractères.' };
  if (looksLikeSiren(q) && !isValidSiren(q)) return { ok: false, reason: 'invalid_siren', message: 'Ce numéro SIREN n’est pas valide. Vérifiez les 9 chiffres.' };
  const url = new URL('/search', opts.baseUrl ?? 'https://recherche-entreprises.api.gouv.fr');
  url.searchParams.set('q', looksLikeSiren(q) ? normalizeSiren(q) : q);
  url.searchParams.set('per_page', '5');
  url.searchParams.set('page', '1');
  const doFetch = opts.fetchImpl ?? fetch;
  const unavailable = { ok: false as const, reason: 'unavailable' as const, message: 'Le service public de recherche d’entreprises ne répond pas. Vous pouvez saisir vos informations manuellement.' };
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 6000), headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return unavailable;
    const parsed = response.safeParse(await res.json());
    if (!parsed.success) return unavailable;
    return { ok: true, companies: parsed.data.results.map(mapCompany) };
  } catch {
    return unavailable;
  }
}
