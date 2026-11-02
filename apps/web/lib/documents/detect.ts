/** Détection du format par le contenu (signature), jamais par la seule extension. */
export type FileKind = 'pdf' | 'xlsx' | 'csv' | 'dsn';
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  dsn: 'text/plain',
};

export function detectFileKind(bytes: Uint8Array, filename: string): FileKind | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b && ext === 'xlsx') return 'xlsx'; // conteneur ZIP + extension attendue
  if (bytes.includes(0)) return null; // binaire inconnu
  const text = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  if (/^S10\.G00\.00\.001,'/m.test(text)) return 'dsn';
  if (ext === 'csv' && /[;,]/.test(text.split(/\r?\n/)[0] ?? '')) return 'csv';
  return null;
}

/** Décodage texte : UTF-8 si valide, sinon Latin-1 (fréquent pour les exports de paie et la DSN). */
export function decodeText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('latin1').decode(bytes); }
}
