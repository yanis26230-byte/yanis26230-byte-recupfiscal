import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Signer { firstName: string; lastName: string; email: string }

/**
 * Signature électronique du mandat. Deux implémentations :
 * - « yousign » : API Yousign v3 (prestataire français) ; non testée contre le service réel ;
 * - « desactive » : aucune signature possible ; le mandat reste « à signer ». Jamais simulée.
 */
export interface SignatureProvider {
  readonly name: 'yousign' | 'desactive';
  readonly enabled: boolean;
  createRequest(input: { title: string; pdf: Uint8Array; filename: string; signer: Signer; externalId: string }): Promise<{ requestId: string; status: string }>;
  downloadSigned(requestId: string): Promise<Uint8Array>;
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhook(rawBody: string): { event: string; requestId: string | null; externalId: string | null };
}

export const disabledSignature: SignatureProvider = {
  name: 'desactive',
  enabled: false,
  createRequest: async () => { throw new Error('Signature électronique non configurée'); },
  downloadSigned: async () => { throw new Error('Signature électronique non configurée'); },
  verifyWebhook: () => false,
  parseWebhook: () => ({ event: 'inconnu', requestId: null, externalId: null }),
};

export function yousignProvider(opts: { apiKey: string; baseUrl: string; webhookSecret: string; fetchImpl?: typeof fetch }): SignatureProvider {
  const f = opts.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${opts.apiKey}` };
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await f(`${opts.baseUrl}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Yousign ${init.method ?? 'GET'} ${path} : ${res.status}`);
    return (res.headers.get('content-type')?.includes('json') ? res.json() : res.arrayBuffer()) as Promise<T>;
  }
  return {
    name: 'yousign',
    enabled: true,
    async createRequest({ title, pdf, filename, signer, externalId }) {
      const req = await call<{ id: string }>('/signature_requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: title, delivery_mode: 'email', timezone: 'Europe/Paris', external_id: externalId }),
      });
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
      form.append('nature', 'signable_document');
      const doc = await call<{ id: string }>(`/signature_requests/${req.id}/documents`, { method: 'POST', body: form });
      await call(`/signature_requests/${req.id}/signers`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          info: { first_name: signer.firstName, last_name: signer.lastName, email: signer.email, locale: 'fr' },
          signature_level: 'electronic_signature', signature_authentication_mode: 'otp_email',
          fields: [{ document_id: doc.id, type: 'signature', page: 1, x: 70, y: 640, width: 200, height: 60 }],
        }),
      });
      const activated = await call<{ status: string }>(`/signature_requests/${req.id}/activate`, { method: 'POST' });
      return { requestId: req.id, status: activated.status ?? 'ongoing' };
    },
    async downloadSigned(requestId) {
      return new Uint8Array(await call<ArrayBuffer>(`/signature_requests/${requestId}/documents/download`, { method: 'GET' }));
    },
    verifyWebhook(rawBody, header) {
      if (!header) return false;
      const expected = 'sha256=' + createHmac('sha256', opts.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(header);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    parseWebhook(rawBody) {
      const j = JSON.parse(rawBody) as { event_name?: string; data?: { signature_request?: { id?: string; external_id?: string } } };
      return { event: j.event_name ?? 'inconnu', requestId: j.data?.signature_request?.id ?? null, externalId: j.data?.signature_request?.external_id ?? null };
    },
  };
}

export function getSignatureProvider(): SignatureProvider {
  if ((process.env.SIGNATURE_PROVIDER ?? 'desactive') !== 'yousign') return disabledSignature;
  const apiKey = process.env.YOUSIGN_API_KEY;
  const webhookSecret = process.env.YOUSIGN_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) throw new Error('YOUSIGN_API_KEY et YOUSIGN_WEBHOOK_SECRET sont requis');
  return yousignProvider({ apiKey, webhookSecret, baseUrl: process.env.YOUSIGN_BASE_URL ?? 'https://api-sandbox.yousign.app/v3' });
}
