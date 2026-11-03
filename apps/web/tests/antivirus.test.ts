import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimPendingAudits } from '@/lib/account-service';
import { clamdScanner, noScanner } from '@/lib/antivirus';
import { createAudit } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { uploadDocument, UploadRejected } from '@/lib/documents/service';
import { localFileStore } from '@/lib/storage';

/** Fichier de test antivirus standard (EICAR), inoffensif, reconnu par tous les antivirus. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Doublure de clamd : implémente le protocole INSTREAM (taille sur 4 octets + données, 0 = fin). */
function fakeClamd(): Promise<{ server: Server; port: number; received: () => number }> {
  let total = 0;
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    let header = false;
    const data: Buffer[] = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!header) {
        const i = buf.indexOf(0);
        if (i < 0) return;
        if (buf.subarray(0, i).toString() !== 'zINSTREAM') { sock.end('UNKNOWN COMMAND\0'); return; }
        buf = buf.subarray(i + 1);
        header = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const content = Buffer.concat(data);
          total += content.length;
          sock.end(content.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        data.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, received: () => total })));
}

let clamd: Awaited<ReturnType<typeof fakeClamd>>;
let db: Database;
let userId: string;
let companyId: string;
const store = localFileStore(mkdtempSync(join(tmpdir(), 'rf-av-')));
const DSN = Buffer.from("S10.G00.00.001,'X'\nS20.G00.05.005,'01012025'\n");

beforeAll(async () => {
  clamd = await fakeClamd();
  db = await createDatabase({ pgliteDataDir: null });
  const l = await createMagicLink(db, 'av@x.fr', '/');
  if ('rateLimited' in l) throw new Error();
  const user = (await consumeMagicLink(db, l.token))!.user;
  userId = user.id;
  const a = await createAudit(db, { company: { siren: '552100554', legalName: 'AV SARL', legalForm: null, nafCode: null, sector: 'autre', createdOn: null, headcountRange: null, source: 'manuel' },
    establishments: [{ key: 'e', siret: null, address: '', postalCode: '', city: 'X', inseeCode: null, concerned: true }], today: '2026-11-03' });
  await db.query(`insert into audit_claims (audit_id, email, expires_at) values ($1, 'av@x.fr', now() + interval '1 day')`, [a.auditId]);
  await claimPendingAudits(db, user);
  companyId = (await db.query<{ id: string }>(`select id::text from companies`))[0]!.id;
});
afterAll(async () => { clamd.server.close(); await db?.close(); });

describe('Client clamd (protocole INSTREAM)', () => {
  it('fichier sain, y compris découpé en plusieurs blocs', async () => {
    const big = Buffer.alloc(200 * 1024, 'a');
    expect(await clamdScanner({ host: '127.0.0.1', port: clamd.port }).scan(big)).toEqual({ status: 'sain' });
    expect(clamd.received()).toBe(200 * 1024);
  });
  it('fichier infecté : signature remontée', async () => {
    expect(await clamdScanner({ host: '127.0.0.1', port: clamd.port }).scan(Buffer.from(EICAR))).toEqual({ status: 'infecte', signature: 'Eicar-Test-Signature' });
  });
  it('antivirus injoignable : non disponible (jamais « sain »)', async () => {
    const r = await clamdScanner({ host: '127.0.0.1', port: 9, timeoutMs: 2000 }).scan(Buffer.from('x'));
    expect(r.status).toBe('non_disponible');
  });
});

describe('Dépôt de documents avec antivirus', () => {
  const scanner = () => clamdScanner({ host: '127.0.0.1', port: clamd.port });
  it('un fichier infecté est refusé et n’est jamais enregistré', async () => {
    const infected = Buffer.from(`S10.G00.00.001,'${EICAR}'\n`);
    await expect(uploadDocument(db, store, userId, companyId, { name: 'dsn.txt', bytes: infected }, { scanner: scanner(), antivirusRequired: true })).rejects.toBeInstanceOf(UploadRejected);
    expect(await db.query(`select 1 from documents`)).toHaveLength(0);
  });
  it('un fichier sain est enregistré avec le statut « sain »', async () => {
    await uploadDocument(db, store, userId, companyId, { name: 'dsn.txt', bytes: DSN }, { scanner: scanner(), antivirusRequired: true });
    expect(await db.query(`select antivirus_status from documents`)).toEqual([{ antivirus_status: 'sain' }]);
  });
  it('antivirus obligatoire mais indisponible : dépôt refusé', async () => {
    const down = clamdScanner({ host: '127.0.0.1', port: 9, timeoutMs: 2000 });
    await expect(uploadDocument(db, store, userId, companyId, { name: 'autre.txt', bytes: Buffer.concat([DSN, Buffer.from('\n')]) }, { scanner: down, antivirusRequired: true })).rejects.toThrow(/indisponible/);
  });
  it('sans antivirus (développement) : enregistré avec le statut « non_disponible »', async () => {
    await uploadDocument(db, store, userId, companyId, { name: 'dev.txt', bytes: Buffer.concat([DSN, Buffer.from('\n\n')]) }, { scanner: noScanner, antivirusRequired: false });
    expect((await db.query<{ antivirus_status: string }>(`select antivirus_status from documents order by created_at`)).map((r) => r.antivirus_status)).toEqual(['sain', 'non_disponible']);
  });
  it('la base refuse tout autre statut', async () => {
    await expect(db.query(`update documents set antivirus_status = 'infecte'`)).rejects.toThrow(/check constraint/);
  });
});
