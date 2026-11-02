import { TEST_PARAMETERS, TEST_REFERENCE_DATA } from '@recupfiscal/engine';
import type { Queryable } from './database';

/**
 * Données de DÉMONSTRATION (jeu « test », valeurs fictives) : paramètres et zonage de test
 * nécessaires à la Boulangerie Démo. Les identifiants texte du moteur sont convertis en UUID
 * déterministes (md5). Jamais utilisées par un audit réel (contrainte sur audits).
 */
export async function seedDemoData(db: Queryable): Promise<void> {
  for (const p of TEST_PARAMETERS) {
    await db.query(
      `insert into public.regulatory_parameters (id, key, label, value, unit, valid_from, valid_to, territory, source_url, verified_at, version, status, dataset, note)
       values (md5($1)::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'publie', 'test', $12) on conflict do nothing`,
      [p.id, p.key, p.label, p.value, p.unit || '-', p.validFrom, p.validTo, p.territory, p.sourceUrl, p.verifiedAt, p.version, p.note ?? null],
    );
  }
  for (const d of TEST_REFERENCE_DATA.zoningDatasets) {
    // Idempotent : un jeu déjà publié n'accepte plus de communes (garde en base).
    const exists = await db.query(`select 1 from public.zoning_datasets where id = md5($1)::uuid`, [d.id]);
    if (exists.length) continue;
    await db.query(
      `insert into public.zoning_datasets (id, zone_type, valid_from, valid_to, source_url, source_label, version, status, dataset)
       values (md5($1)::uuid, $2, $3, $4, $5, $6, $7, 'brouillon', 'test') on conflict do nothing`,
      [d.id, d.zoneType, d.validFrom, d.validTo, d.sourceUrl, d.sourceLabel, d.version],
    );
    for (const e of TEST_REFERENCE_DATA.zoningEntries.filter((x) => x.datasetId === d.id)) {
      await db.query(
        `insert into public.zoning_entries (id, dataset_id, insee_code, commune_name, valid_from, valid_to) values (md5($1)::uuid, md5($2)::uuid, $3, $4, $5, $6) on conflict do nothing`,
        [e.id, e.datasetId, e.inseeCode, e.communeName, e.validFrom, e.validTo],
      );
    }
    // Publication en tant que service (le cycle de vie complet à quatre yeux s'applique aux utilisateurs).
    await db.query(`update public.zoning_datasets set status = 'publie', validator_id = null where id = md5($1)::uuid and status = 'brouillon'`, [d.id]);
  }
  for (const s of TEST_REFERENCE_DATA.zoneSchemes) {
    await db.query(
      `insert into public.zone_schemes (id, zone_type, code, name, description, conditions, documents_to_provide, source_url, valid_from, valid_to, version, status, dataset)
       values (md5($1)::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, 'publie', 'test') on conflict do nothing`,
      [s.id, s.zoneType, s.code, s.name, s.description, JSON.stringify(s.conditions), JSON.stringify(s.documentsToProvide), s.sourceUrl, s.validFrom, s.validTo, s.version],
    );
  }
}
