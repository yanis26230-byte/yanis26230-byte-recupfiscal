import { describe, expect, it } from 'vitest';
import {
  MODULE_REGISTRY, runCalculation, SALARY_BRACKETS, TEST_PARAMETERS, TEST_REFERENCE_DATA, demoQuickInput,
} from '@recupfiscal/engine';
import { mapCompany, searchCompanies } from '@/lib/company-search';
import { demoAnswers } from '@/lib/demo';
import { BRACKETS, parseFrNumber, quickModeYears, submissionIssues } from '@/lib/questionnaire';
import { sectorFromNaf, helpFor } from '@/lib/sectors';
import { isValidSiren } from '@/lib/siren';
import { toEngineInput } from '@/lib/to-engine-input';

/** Réponse au format documenté de l'API Recherche d'entreprises (champs utilisés uniquement). */
const API_FIXTURE = {
  results: [{
    siren: '552100554', nom_complet: 'EXEMPLE BOULANGERIE (EXEMPLE)', nom_raison_sociale: 'EXEMPLE BOULANGERIE', nature_juridique: '5499',
    activite_principale: '10.71C', date_creation: '2015-03-01', tranche_effectif_salarie: '11', etat_administratif: 'A', nombre_etablissements_ouverts: 3,
    siege: { siret: '55210055400013', adresse: '1 RUE EXEMPLE 26000 VALENCE', code_postal: '26000', commune: '26362', libelle_commune: 'VALENCE', est_siege: true, etat_administratif: 'A' },
    matching_etablissements: [
      { siret: '55210055400013', adresse: '1 RUE EXEMPLE', code_postal: '26000', commune: '26362', libelle_commune: 'VALENCE', est_siege: true, etat_administratif: 'A' },
      { siret: '55210055400021', adresse: '2 AV EXEMPLE', code_postal: '26500', commune: '26058', libelle_commune: 'BOURG-LES-VALENCE', est_siege: false, etat_administratif: 'A' },
      { siret: '55210055400039', adresse: 'ANCIEN SITE', code_postal: '26000', commune: '26362', libelle_commune: 'VALENCE', est_siege: false, etat_administratif: 'F' },
    ],
    champ_inconnu: { ignore: true },
  }],
  total_results: 1, page: 1, per_page: 5,
};

describe('SIREN', () => {
  it('contrôle la clé de Luhn', () => {
    expect(isValidSiren('552 100 554')).toBe(true);
    expect(isValidSiren('552100555')).toBe(false);
    expect(isValidSiren('356000000')).toBe(true); // La Poste
    expect(isValidSiren('12345678')).toBe(false);
  });
});

describe('Recherche d’entreprises', () => {
  it('pré-remplit raison sociale, forme, NAF, secteur, siège, création, effectif et établissements ouverts', () => {
    const c = mapCompany(API_FIXTURE.results[0] as never);
    expect(c).toMatchObject({ siren: '552100554', legalName: 'EXEMPLE BOULANGERIE', legalForm: 'SARL', nafCode: '10.71C', sector: 'artisanat_alimentaire',
      createdOn: '2015-03-01', headcountRange: '10 à 19 salariés', openEstablishmentsCount: 3 });
    expect(c.establishments.map((e) => [e.siret, e.inseeCode, e.isHeadOffice])).toEqual([['55210055400013', '26362', true], ['55210055400021', '26058', false]]);
  });
  it('appelle l’API avec le SIREN normalisé', async () => {
    let called = '';
    const r = await searchCompanies('552 100 554', { fetchImpl: (async (url: URL) => { called = String(url); return new Response(JSON.stringify(API_FIXTURE)); }) as never });
    expect(called).toBe('https://recherche-entreprises.api.gouv.fr/search?q=552100554&per_page=5&page=1');
    expect(r.ok && r.companies).toHaveLength(1);
  });
  it('API indisponible, en erreur ou au format inattendu : bascule vers la saisie manuelle', async () => {
    for (const impl of [async () => { throw new Error('réseau'); }, async () => new Response('x', { status: 503 }), async () => new Response('{"oops":1}')]) {
      const r = await searchCompanies('boulangerie', { fetchImpl: impl as never });
      expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
    }
  });
  it('refuse un SIREN invalide sans appeler l’API', async () => {
    const r = await searchCompanies('552100555', { fetchImpl: (() => { throw new Error('ne doit pas être appelé'); }) as never });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_siren' });
  });
});

describe('Secteurs et aide contextuelle', () => {
  it.each([['43.22A', 'batiment'], ['10.71C', 'artisanat_alimentaire'], ['47.11F', 'commerce'], ['56.10A', 'restauration'], ['25.62B', 'industrie'], ['62.01Z', 'autre'], [null, 'autre']])(
    'NAF %s -> %s', (naf, sector) => expect(sectorFromNaf(naf)).toBe(sector));
  it('ajoute une aide sectorielle quand elle existe', () => {
    expect(helpFor('salaires', 'restauration').sector).toMatch(/avantages en nature/);
    expect(helpFor('salaires', 'autre').sector).toBeNull();
  });
});

describe('Questionnaire', () => {
  it('mêmes tranches que le moteur', () => expect(BRACKETS.map((b) => b.id)).toEqual([...SALARY_BRACKETS]));
  it('années : deux années précédentes et année en cours', () => expect(quickModeYears('2026-11-02')).toEqual([2024, 2025, 2026]));
  it('saisie de nombres à la française', () => {
    expect(parseFrNumber('1 234,50 €')).toBe(1234.5);
    expect(parseFrNumber('2,7 %')).toBe(2.7);
    expect(parseFrNumber('')).toBeNull();
    expect(parseFrNumber('abc')).toBeNull();
  });
  it('contrôles avant calcul', () => {
    const { answers, meta } = demoAnswers();
    expect(submissionIssues(answers, meta).filter((i) => i.blocking)).toEqual([]);
    const missing = { ...answers, recapitulatif: { ...answers.recapitulatif, consent: false }, entreprise: { ...answers.entreprise, headcountByYear: {} } };
    const msgs = submissionIssues(missing, meta).map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/effectif moyen 2023/);
    expect(msgs).toMatch(/consentement/);
  });
});

describe('Conversion des réponses vers le moteur (Boulangerie Démo)', () => {
  const { answers, meta } = demoAnswers();
  const run = (input: ReturnType<typeof toEngineInput>) => runCalculation(input, { modules: MODULE_REGISTRY, parameters: TEST_PARAMETERS, dataset: 'test', referenceData: TEST_REFERENCE_DATA });
  const fromAnswers = run(toEngineInput(answers, meta, meta.fixedAsOfDate!));
  const reference = run(demoQuickInput());
  const pick = (r: typeof reference, m: string) => r.opportunities.filter((o) => o.moduleId === m).map((o) => [o.year, o.kind, o.status, o.amounts]);
  it('réduction générale et simulateur identiques aux données de référence du moteur', () => {
    expect(pick(fromAnswers, 'M1_REDUCTION_GENERALE')).toEqual(pick(reference, 'M1_REDUCTION_GENERALE'));
    expect(pick(fromAnswers, 'M5_EPARGNE_SALARIALE')).toEqual(pick(reference, 'M5_EPARGNE_SALARIALE'));
  });
  it('aide apprenti : même montant, confiance faible (date de début approximative)', () => {
    const o = fromAnswers.opportunities.find((x) => x.moduleId === 'M2_AIDES_EMBAUCHE' && x.status === 'estime')!;
    expect(o.amounts!.central).toBe(3000);
    expect(o.confidence).toBe('faible');
  });
  it('taux AT déclaré en mode rapide : jamais de conclusion ferme', () => {
    const o = fromAnswers.opportunities.find((x) => x.moduleId === 'M3_TAUX_AT' && x.year === 2024)!;
    expect(o.status).toBe('a_confirmer');
    expect(o.amounts).toBeNull();
  });
});
