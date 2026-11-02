import { describe, expect, it } from 'vitest';
import { buildPgConfig } from '@/lib/db/database';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIDxzCCAq+gAwIBAgIU\n-----END CERTIFICATE-----\n';
const SUPA = 'postgresql://postgres.abc:mdp@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

describe('Connexion PostgreSQL : TLS toujours vérifié', () => {
  it('vérifie le certificat du serveur par défaut', () => {
    expect(buildPgConfig(SUPA).ssl).toEqual({ rejectUnauthorized: true });
  });
  it('ajoute le certificat racine fourni (PEM sur une ligne, \\n littéraux)', () => {
    const oneLine = PEM.replace(/\n/g, '\\n');
    expect(buildPgConfig(SUPA, { ca: oneLine }).ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(buildPgConfig(SUPA, { caFile: '/x/ca.crt' }, () => PEM).ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
  });
  it('refuse un contenu qui n’est pas un certificat', () => {
    expect(() => buildPgConfig(SUPA, { ca: 'n’importe quoi' })).toThrow(/PEM/);
  });
  it('les paramètres TLS de l’URL ne peuvent pas affaiblir la vérification', () => {
    const c = buildPgConfig(`${SUPA}?sslmode=no-verify&sslrootcert=/tmp/x&application_name=rf`);
    expect(c.connectionString).toBe(`${SUPA}?application_name=rf`);
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
  });
  it('TLS désactivable uniquement pour une base locale', () => {
    expect(buildPgConfig('postgresql://u:p@localhost:5432/db').ssl).toBe(false);
    expect(() => buildPgConfig(SUPA, { disable: true })).toThrow(/locale/);
  });
});
