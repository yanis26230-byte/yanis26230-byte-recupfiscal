import { AccessDenied } from '@/lib/audit-service';
import { getDb } from '@/lib/db';
import { readReport } from '@/lib/report/report-service';
import { auditAccess } from '@/lib/server/access';
import { getFileStore } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { bytes, filename } = await readReport(await getDb(), getFileStore(), id, auditAccess);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof AccessDenied) return new Response('Introuvable', { status: 404 });
    console.error(e);
    return new Response('Rapport indisponible', { status: 500 });
  }
}
