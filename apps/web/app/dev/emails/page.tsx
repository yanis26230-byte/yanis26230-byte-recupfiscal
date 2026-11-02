import { notFound } from 'next/navigation';
import { Alert, Card } from '@/components/ui/card';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Boîte d’envoi de développement', robots: { index: false } };

/** Développement uniquement : e-mails déposés au lieu d'être envoyés (MAIL_PROVIDER=outbox). */
export default async function DevEmails() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_OUTBOX !== 'true') notFound();
  const db = await getDb();
  const mails = await db.query<{ id: number; to_email: string; subject: string; text_body: string; created_at: string }>(
    `select id, to_email, subject, text_body, created_at::text from local_auth.outbox order by id desc limit 50`);
  const linkify = (t: string) => t.split(/(https?:\/\/\S+)/).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} className="break-all text-brand underline">{part}</a> : part));
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Boîte d’envoi de développement</h1>
      <Alert tone="warn">Environnement de développement : les e-mails ne sont pas envoyés, ils sont affichés ici. Cette page n’existe pas en production.</Alert>
      {mails.length === 0 && <p className="text-muted">Aucun e-mail.</p>}
      {mails.map((m) => (
        <Card key={m.id} data-testid="dev-email" data-to={m.to_email}>
          <p className="text-sm text-muted">À : {m.to_email} · {m.created_at.slice(0, 19)}</p>
          <p className="mt-1 font-semibold">{m.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{linkify(m.text_body)}</p>
        </Card>
      ))}
    </div>
  );
}
