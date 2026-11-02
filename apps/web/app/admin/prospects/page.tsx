import Link from 'next/link';
import { listLeads } from '@/lib/admin-service';
import { adminUser } from '@/lib/server/admin-guard';
import { getDb } from '@/lib/db';
import { formatEur } from '@/lib/questionnaire';
import { SECTOR_LABELS, type SectorId } from '@/lib/sectors';

export default async function Prospects() {
  const user = await adminUser();
  const leads = await listLeads(await getDb(), user.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Prospects ({leads.length})</h1>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-full text-sm" data-testid="leads">
          <thead className="bg-surface text-left text-xs text-muted"><tr>{['Entreprise', 'SIREN', 'Secteur', 'Effectif', 'Contact', 'Date', 'Mode', 'Fourchette', 'Statut', 'Activité'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{l.audit_id ? <Link className="text-brand underline" href={`/admin/audits/${l.audit_id}`}>{l.company_name ?? '—'}</Link> : l.company_name ?? '—'}</td>
                <td className="px-3 py-2 tabular">{l.siren ?? '—'}</td>
                <td className="px-3 py-2">{SECTOR_LABELS[l.sector as SectorId] ?? '—'}</td>
                <td className="px-3 py-2">{l.headcount ?? '—'}</td>
                <td className="px-3 py-2">{l.first_name} · {l.email}{l.phone ? ` · ${l.phone}` : ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{new Date(l.created_at).toLocaleDateString('fr-FR')}</td>
                <td className="px-3 py-2">{l.mode ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular">{l.past_high ? `${formatEur(l.past_low ?? 0)} – ${formatEur(l.past_high)}` : '—'}</td>
                <td className="px-3 py-2">{l.status}</td>
                <td className="px-3 py-2 whitespace-nowrap">{new Date(l.last_activity_at).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
