/**
 * Formules du simulateur M5, par salarié et pour une même enveloppe de coût employeur C.
 * Aucune valeur réglementaire en dur : tous les taux et plafonds sont passés en argument.
 * Hypothèse de simulation : l'impôt sur le revenu est approché par net imposable × TMI,
 * le net imposable étant assimilé au net avant impôt.
 */

export interface ScenarioResult {
  id: ScenarioId;
  label: string;
  applicable: boolean;
  notApplicableReason?: string;
  employerCost: number;
  /** Cotisations patronales et forfait social. */
  employerContributions: number;
  /** Cotisations salariales et CSG/CRDS. */
  employeeContributions: number;
  netBeforeTax: number;
  /** null si le TMI est inconnu et que la somme est imposable. */
  incomeTax: number | null;
  netAfterTax: number | null;
  /** Part de l'enveloppe non utilisable (plafonds). */
  unusedEnvelope: number;
  /** Sommes bloquées (PEE). */
  blocked: boolean;
  detail: Record<string, number>;
}

export type ScenarioId = 'augmentation_salaire' | 'prime_classique' | 'interessement' | 'interessement_pee_abondement' | 'ppv' | 'titres_restaurant';

const tax = (taxable: number, tmi: number | null) => (tmi === null ? null : taxable * tmi);
const after = (net: number, t: number | null) => (t === null ? null : net - t);

export function salaryLike(id: 'augmentation_salaire' | 'prime_classique', label: string, C: number, employerRate: number, employeeRate: number, tmi: number | null): ScenarioResult {
  const gross = C / (1 + employerRate);
  const employeeContributions = gross * employeeRate;
  const net = gross - employeeContributions;
  const t = tax(net, tmi);
  return { id, label, applicable: true, employerCost: C, employerContributions: C - gross, employeeContributions, netBeforeTax: net,
    incomeTax: t, netAfterTax: after(net, t), unusedEnvelope: 0, blocked: false, detail: { brut: gross } };
}

export interface ProfitSharingParams { forfaitSocial: number; csgCrds: number; individualCap: number }

export function profitSharingPaid(C: number, p: ProfitSharingParams, tmi: number | null): ScenarioResult {
  const amount = Math.min(C / (1 + p.forfaitSocial), p.individualCap);
  const cost = amount * (1 + p.forfaitSocial);
  const csg = amount * p.csgCrds;
  const net = amount - csg;
  const t = tax(net, tmi);
  return { id: 'interessement', label: 'Intéressement versé', applicable: true, employerCost: cost, employerContributions: cost - amount,
    employeeContributions: csg, netBeforeTax: net, incomeTax: t, netAfterTax: after(net, t), unusedEnvelope: C - cost, blocked: false,
    detail: { interessement: amount, plafondIndividuel: p.individualCap } };
}

export interface MatchingParams extends ProfitSharingParams { forfaitSocialMatching: number; matchingCap: number; matchingMaxRatio: number }

/** Intéressement placé sur le PEE + abondement : résolution exacte de l'équation de coût (linéaire par morceaux). */
export function profitSharingWithMatching(C: number, p: MatchingParams): ScenarioResult {
  const fi = 1 + p.forfaitSocial;
  const fa = 1 + p.forfaitSocialMatching;
  let I = C / (fi + p.matchingMaxRatio * fa);
  let A = p.matchingMaxRatio * I;
  if (A > p.matchingCap) {
    A = p.matchingCap;
    I = (C - A * fa) / fi;
  }
  if (I > p.individualCap) {
    I = p.individualCap;
    A = Math.min(p.matchingMaxRatio * I, p.matchingCap);
  }
  const cost = I * fi + A * fa;
  const csg = (I + A) * p.csgCrds;
  const net = I + A - csg;
  return { id: 'interessement_pee_abondement', label: 'Intéressement placé sur PEE + abondement', applicable: true, employerCost: cost,
    employerContributions: cost - I - A, employeeContributions: csg, netBeforeTax: net, incomeTax: 0, netAfterTax: net,
    unusedEnvelope: C - cost, blocked: true, detail: { interessement: I, abondement: A, plafondAbondement: p.matchingCap } };
}

export interface PpvParams { cap: number; forfaitSocial: number; csgCrds: number; incomeTaxExempt: boolean; salaryThreshold: number }

export function valueSharingBonus(C: number, averageGross: number, p: PpvParams, tmi: number | null): ScenarioResult {
  if (averageGross >= p.salaryThreshold) {
    return { id: 'ppv', label: 'Prime de partage de la valeur', applicable: false, notApplicableReason: 'Rémunération moyenne au-delà du seuil du régime paramétré',
      employerCost: 0, employerContributions: 0, employeeContributions: 0, netBeforeTax: 0, incomeTax: 0, netAfterTax: 0, unusedEnvelope: C, blocked: false,
      detail: { seuilRemuneration: p.salaryThreshold } };
  }
  const amount = Math.min(C / (1 + p.forfaitSocial), p.cap);
  const cost = amount * (1 + p.forfaitSocial);
  const csg = amount * p.csgCrds;
  const net = amount - csg;
  const t = p.incomeTaxExempt ? 0 : tax(net, tmi);
  return { id: 'ppv', label: 'Prime de partage de la valeur', applicable: true, employerCost: cost, employerContributions: cost - amount,
    employeeContributions: csg, netBeforeTax: net, incomeTax: t, netAfterTax: after(net, t), unusedEnvelope: C - cost, blocked: false,
    detail: { prime: amount, plafond: p.cap } };
}

export interface MealVoucherParams { maxExemptEmployerShare: number; maxEmployerRatio: number }

export function mealVouchers(C: number, mealDays: number, p: MealVoucherParams): ScenarioResult {
  const perVoucher = p.maxExemptEmployerShare;
  const faceValue = perVoucher / p.maxEmployerRatio;
  const count = Math.max(0, Math.min(Math.floor(C / perVoucher), Math.floor(mealDays)));
  const cost = count * perVoucher;
  return { id: 'titres_restaurant', label: 'Titres-restaurant', applicable: true, employerCost: cost, employerContributions: 0, employeeContributions: 0,
    netBeforeTax: cost, incomeTax: 0, netAfterTax: cost, unusedEnvelope: C - cost, blocked: false,
    detail: { nombreTitres: count, valeurFaciale: faceValue, partPatronaleParTitre: perVoucher, quotePartSalarie: count * (faceValue - perVoucher) } };
}
