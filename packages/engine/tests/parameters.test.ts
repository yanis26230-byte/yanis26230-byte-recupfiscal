import { describe, expect, it } from 'vitest';
import { ParameterResolver } from '../src/index.js';
import { param } from './helpers.js';

const K = 'smic_horaire';

describe('Résolution des paramètres réglementaires', () => {
  it('utilise uniquement un paramètre publié couvrant la période', () => {
    const r = new ParameterResolver([param({ id: 'a', key: K, value: 10, validFrom: '2024-01-01', validTo: '2024-12-31' })], { dataset: 'test' });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(res.ok && res.value).toBe(10);
    expect(r.usedParameters().map((p) => p.id)).toEqual(['a']);
  });

  it('n’utilise jamais la valeur d’une autre année', () => {
    const r = new ParameterResolver([
      param({ id: 'y23', key: K, value: 9, validFrom: '2023-01-01', validTo: '2023-12-31' }),
      param({ id: 'y25', key: K, value: 11, validFrom: '2025-01-01', validTo: '2025-12-31' }),
    ], { dataset: 'test' });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing.reason).toBe('absent');
    expect(r.usedParameters()).toEqual([]);
  });

  it.each(['a_renseigner', 'brouillon', 'valide', 'archive'] as const)('refuse un paramètre au statut %s', (status) => {
    const r = new ParameterResolver([param({ id: 'a', key: K, value: 10, status, validFrom: '2024-01-01', validTo: '2024-12-31' })], { dataset: 'test' });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.missing.reason).toBe('non_publie'); expect(res.missing.foundStatuses).toEqual([status]); }
  });

  it('ne mélange jamais jeu officiel et jeu de test', () => {
    const r = new ParameterResolver([param({ id: 'a', key: K, validFrom: '2024-01-01', dataset: 'test' })], { dataset: 'officiel' });
    expect(r.resolve(K, '2024-01-01', '2024-12-31').ok).toBe(false);
  });

  it('refuse une couverture partielle de la période', () => {
    const r = new ParameterResolver([param({ id: 'a', key: K, validFrom: '2024-03-01', validTo: '2024-12-31' })], { dataset: 'test' });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(!res.ok && res.missing.reason).toBe('couverture_partielle');
  });

  it('refuse un trou entre deux versions', () => {
    const r = new ParameterResolver([
      param({ id: 'a', key: K, validFrom: '2024-01-01', validTo: '2024-05-31' }),
      param({ id: 'b', key: K, validFrom: '2024-07-01', validTo: '2024-12-31' }),
    ], { dataset: 'test' });
    expect(r.resolveSegments(K, '2024-01-01', '2024-12-31').ok).toBe(false);
  });

  it('refuse deux versions publiées qui se chevauchent (ambiguïté)', () => {
    const r = new ParameterResolver([
      param({ id: 'a', key: K, validFrom: '2024-01-01', validTo: '2024-12-31' }),
      param({ id: 'b', key: K, version: 2, validFrom: '2024-06-01', validTo: '2024-12-31' }),
    ], { dataset: 'test' });
    const res = r.resolveSegments(K, '2024-01-01', '2024-12-31');
    expect(!res.ok && res.missing.reason).toBe('ambigu');
  });

  it('découpe une période couverte par deux valeurs successives', () => {
    const r = new ParameterResolver([
      param({ id: 'a', key: K, value: 12, validFrom: '2023-01-01', validTo: '2023-04-30' }),
      param({ id: 'b', key: K, value: 12.2, validFrom: '2023-05-01', validTo: '2023-12-31' }),
    ], { dataset: 'test' });
    const res = r.resolveSegments(K, '2023-01-01', '2023-12-31');
    expect(res.ok && res.segments.map((s) => [s.from, s.to, s.value])).toEqual([
      ['2023-01-01', '2023-04-30', 12], ['2023-05-01', '2023-12-31', 12.2],
    ]);
    // resolve() exige une valeur unique
    const single = r.resolve(K, '2023-01-01', '2023-12-31');
    expect(!single.ok && single.missing.reason).toBe('decoupage_infra_annuel');
  });

  it('refuse un paramètre publié sans valeur', () => {
    const r = new ParameterResolver([param({ id: 'a', key: K, value: null, validFrom: '2024-01-01' })], { dataset: 'test' });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(!res.ok && res.missing.reason).toBe('sans_valeur');
  });

  it('en mode rejeu, n’accepte que les identifiants épinglés, même archivés', () => {
    const params = [
      param({ id: 'old', key: K, value: 10, status: 'archive', validFrom: '2024-01-01', validTo: '2024-12-31' }),
      param({ id: 'new', key: K, value: 11, version: 2, validFrom: '2024-01-01', validTo: '2024-12-31' }),
    ];
    const r = new ParameterResolver(params, { dataset: 'test', pinnedIds: new Set(['old']) });
    const res = r.resolve(K, '2024-01-01', '2024-12-31');
    expect(res.ok && res.value).toBe(10);
  });
});
