import { connect } from 'node:net';

/**
 * Analyse antivirale des fichiers déposés, AVANT tout stockage.
 * - « clamav » : démon ClamAV (clamd) interrogé en TCP, protocole INSTREAM ;
 * - « aucun » : pas d'analyse (statut « non_disponible »).
 * En production, l'analyse est obligatoire par défaut (ANTIVIRUS_REQUIRED) : sans antivirus
 * joignable, le dépôt est refusé plutôt qu'accepté sans contrôle.
 */
export type ScanResult =
  | { status: 'sain' }
  | { status: 'infecte'; signature: string }
  | { status: 'non_disponible'; reason: string };

export interface Scanner { readonly name: 'clamav' | 'aucun'; scan(bytes: Uint8Array): Promise<ScanResult> }

export const noScanner: Scanner = { name: 'aucun', scan: async () => ({ status: 'non_disponible', reason: 'aucun antivirus configuré' }) };

const CHUNK = 64 * 1024;

export function clamdScanner(opts: { host: string; port: number; timeoutMs?: number }): Scanner {
  return {
    name: 'clamav',
    scan: (bytes) => new Promise<ScanResult>((resolve) => {
      const socket = connect({ host: opts.host, port: opts.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const done = (r: ScanResult) => { if (!settled) { settled = true; socket.destroy(); resolve(r); } };
      socket.setTimeout(opts.timeoutMs ?? 30_000, () => done({ status: 'non_disponible', reason: 'délai dépassé' }));
      socket.on('error', (e) => done({ status: 'non_disponible', reason: e.message }));
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        if (/^stream: OK$/.test(reply)) return done({ status: 'sain' });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found) return done({ status: 'infecte', signature: found[1]! });
        done({ status: 'non_disponible', reason: `réponse inattendue : ${reply.slice(0, 120)}` });
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const part = bytes.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // fin du flux
      });
    }),
  };
}

export function getScanner(): Scanner {
  if ((process.env.ANTIVIRUS_PROVIDER ?? 'aucun') !== 'clamav') return noScanner;
  return clamdScanner({ host: process.env.CLAMD_HOST ?? '127.0.0.1', port: Number(process.env.CLAMD_PORT ?? 3310), timeoutMs: Number(process.env.CLAMD_TIMEOUT_MS ?? 30_000) });
}

export function antivirusRequired(): boolean {
  if (process.env.ANTIVIRUS_REQUIRED) return process.env.ANTIVIRUS_REQUIRED === 'true';
  return process.env.NODE_ENV === 'production';
}
