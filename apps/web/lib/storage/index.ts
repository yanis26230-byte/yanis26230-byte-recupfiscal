import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export type Bucket = 'documents' | 'reports';

/** Stockage privé des fichiers. Les fichiers ne sont jamais servis publiquement : le serveur contrôle l'accès. */
export interface FileStore {
  readonly name: 'local' | 'supabase';
  put(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, path: string): Promise<Buffer | null>;
  /** Suppression définitive (droit à l'effacement, purge). */
  remove(bucket: Bucket, path: string): Promise<void>;
}

const SAFE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._\-/]{1,200}$/;

export function assertSafePath(path: string) {
  if (!SAFE_PATH.test(path) || path.includes('..') || path.includes('//')) throw new Error(`Chemin de fichier refusé : ${path}`);
}

/** Développement et tests : fichiers sur disque, hors du dossier public. */
export function localFileStore(root: string): FileStore {
  const base = resolve(root);
  const full = (bucket: Bucket, path: string) => {
    assertSafePath(path);
    const p = resolve(join(base, bucket, path));
    if (!p.startsWith(base + sep)) throw new Error('Chemin hors du stockage');
    return p;
  };
  return {
    name: 'local',
    async put(bucket, path, bytes) {
      const p = full(bucket, path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, bytes, { flag: 'wx' }); // jamais d'écrasement
    },
    async get(bucket, path) {
      try { return await readFile(full(bucket, path)); } catch { return null; }
    },
    async remove(bucket, path) {
      const { rm } = await import('node:fs/promises');
      await rm(full(bucket, path), { force: true });
    },
  };
}

/**
 * Production : Supabase Storage (seaux privés, région UE), avec la clé de service côté serveur.
 * Non testé contre un projet réel depuis l'environnement de développement.
 */
export function supabaseFileStore(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): FileStore {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  return {
    name: 'supabase',
    async put(bucket, path, bytes, contentType) {
      assertSafePath(path);
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { ...headers, 'content-type': contentType, 'x-upsert': 'false' }, body: bytes as BodyInit });
      if (!res.ok) throw new Error(`Stockage : échec de l’envoi (${res.status})`);
    },
    async get(bucket, path) {
      assertSafePath(path);
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}/${path}`, { headers });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Stockage : échec de la lecture (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(bucket, path) {
      assertSafePath(path);
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) });
      if (!res.ok && res.status !== 404) throw new Error(`Stockage : échec de la suppression (${res.status})`);
    },
  };
}

export function getFileStore(): FileStore {
  const provider = process.env.STORAGE_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'local');
  if (provider === 'supabase') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour le stockage');
    return supabaseFileStore(url, key);
  }
  return localFileStore(process.env.LOCAL_STORAGE_DIR ?? '.data/files');
}
