import { roundCents } from './money.js';
import type { AmountRange } from './types.js';

/**
 * Commission INDICATIVE affichée sur la page de résultats. Elle n'est jamais facturée :
 * la commission réelle est calculée uniquement sur un remboursement effectivement encaissé
 * et saisi par un administrateur (voir realCommission).
 */
export function indicativeCommission(pastRecovery: AmountRange, rate: number) {
  assertRate(rate);
  const c = (x: number) => roundCents(x * rate);
  const commission: AmountRange = { low: c(pastRecovery.low), central: c(pastRecovery.central), high: c(pastRecovery.high) };
  const netGain: AmountRange = {
    low: roundCents(pastRecovery.low - commission.low),
    central: roundCents(pastRecovery.central - commission.central),
    high: roundCents(pastRecovery.high - commission.high),
  };
  return { rate, commission, netGain };
}

export interface RecordedRecovery {
  amountReimbursed: number;
  receivedOn: string;
  proofDocumentId: string | null;
  recordedByRole: 'admin' | 'analyst' | 'client' | string;
}

/** Commission réelle : uniquement sur un remboursement réel, justifié, saisi par un administrateur. */
export function realCommission(recovery: RecordedRecovery, rate: number): number {
  assertRate(rate);
  if (recovery.recordedByRole !== 'admin') throw new Error('Seul un administrateur peut enregistrer un remboursement.');
  if (!recovery.proofDocumentId) throw new Error('Un justificatif de remboursement est obligatoire.');
  if (!(recovery.amountReimbursed > 0)) throw new Error('Le montant remboursé doit être strictement positif.');
  return roundCents(recovery.amountReimbursed * rate);
}

function assertRate(rate: number) {
  if (!(rate >= 0 && rate <= 1)) throw new Error(`Taux de commission invalide : ${rate}`);
}
