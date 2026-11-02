import type { Queryable } from '../db/database';

export interface Email { to: string; subject: string; text: string; html?: string }
export interface Mailer { readonly name: 'outbox' | 'brevo'; send(email: Email): Promise<void> }

/**
 * Développement et tests : l'e-mail est déposé dans local_auth.outbox (consultable sur /dev/emails)
 * au lieu d'être envoyé. Interdit en production.
 */
export function outboxMailer(db: Queryable): Mailer {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_OUTBOX !== 'true') {
    throw new Error('La boîte d’envoi de développement est interdite en production : configurez MAIL_PROVIDER=brevo.');
  }
  return {
    name: 'outbox',
    async send(e) {
      await db.query(`insert into local_auth.outbox (to_email, subject, text_body, html_body) values ($1, $2, $3, $4)`, [e.to, e.subject, e.text, e.html ?? null]);
    },
  };
}

/**
 * Brevo (prestataire français, données hébergées dans l'UE) : API transactionnelle.
 * Non testé contre le service réel depuis l'environnement de développement (réseau restreint).
 */
export function brevoMailer(opts: { apiKey: string; senderEmail: string; senderName: string; fetchImpl?: typeof fetch }): Mailer {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: 'brevo',
    async send(e) {
      const res = await doFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': opts.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: opts.senderEmail, name: opts.senderName }, to: [{ email: e.to }], subject: e.subject, textContent: e.text, htmlContent: e.html ?? `<pre>${escapeHtml(e.text)}</pre>` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Envoi de l’e-mail impossible (Brevo ${res.status})`);
    },
  };
}

export function getMailer(db: Queryable): Mailer {
  const provider = process.env.MAIL_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'brevo' : 'outbox');
  if (provider === 'brevo') {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.MAIL_FROM_EMAIL;
    if (!apiKey || !senderEmail) throw new Error('BREVO_API_KEY et MAIL_FROM_EMAIL sont requis');
    return brevoMailer({ apiKey, senderEmail, senderName: process.env.MAIL_FROM_NAME ?? 'Récupération PME' });
  }
  return outboxMailer(db);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function linkEmail(opts: { to: string; subject: string; intro: string; cta: string; url: string; outro?: string }): Email {
  const text = `${opts.intro}\n\n${opts.cta} : ${opts.url}\n\n${opts.outro ?? ''}`.trim();
  const html = `<p>${escapeHtml(opts.intro)}</p><p><a href="${escapeHtml(opts.url)}">${escapeHtml(opts.cta)}</a></p>${opts.outro ? `<p style="color:#5b6b80">${escapeHtml(opts.outro)}</p>` : ''}`;
  return { to: opts.to, subject: opts.subject, text, html };
}
