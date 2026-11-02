import Link from 'next/link';
import { Badge } from '@/components/ui/card';
import { adminUser } from '@/lib/server/admin-guard';
import { CASE_STATUS_LABELS, listCasesAdmin } from '@/lib/case-service';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';

export default async function Dossiers() {
  const user = await adminUser();
  const cases = await listCasesAdmin(await getDb(), user.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dossiers ({cases.length})</h1>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white" data-testid="admin-cases">
        {cases.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <Link className="font-medium text-brand underline" href={`/admin/dossiers/${c.id}`}>{c.company_name}</Link>
            <span className="text-muted">SIREN {c.siren} · mandat {c.mandate_status ?? '—'} · estimé jusqu’à {c.estimated_high ? formatEur(c.estimated_high) : '—'}</span>
            <span className="flex gap-2"><Badge tone={c.verification_status === 'verifiee' ? 'good' : 'warn'}>{c.verification_status}</Badge><Badge tone="info">{CASE_STATUS_LABELS[c.status]}</Badge></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
