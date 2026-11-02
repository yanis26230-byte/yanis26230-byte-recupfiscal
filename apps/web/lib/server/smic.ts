import 'server-only';
import { M1_KEYS, monthEnd, monthStart, ParameterResolver, yearEnd, yearStart, type ParameterDataset } from '@recupfiscal/engine';
import { loadParameters } from '@/lib/audit-service';
import { getDb } from '@/lib/db';

/**
 * SMIC annuel temps plein de chaque année, uniquement s'il est publié dans le jeu de paramètres
 * de l'audit. Sert à afficher l'équivalent en euros des tranches ; null sinon (jamais estimé).
 */
export async function annualSmicByYear(dataset: ParameterDataset, years: number[]): Promise<Record<string, number | null>> {
  const params = await loadParameters(await getDb(), dataset);
  const out: Record<string, number | null> = {};
  for (const y of years) {
    const r = new ParameterResolver(params, { dataset });
    const hours = r.resolve(M1_KEYS.dureeMensuelle, yearStart(y), yearEnd(y));
    let total: number | null = hours.ok ? 0 : null;
    for (let m = 1; m <= 12 && total !== null; m++) {
      const s = r.resolve(M1_KEYS.smicHoraire, monthStart(y, m), monthEnd(y, m));
      total = s.ok && hours.ok ? total + s.value * hours.value : null;
    }
    out[String(y)] = total === null ? null : Math.round(total * 100) / 100;
  }
  return out;
}
