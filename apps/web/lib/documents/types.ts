/** Valeur d'une ligne de paie extraite (une ligne = un salarié, un mois). */
export interface PayrollFieldValue {
  employeeRef: string;
  year: number;
  month: number;
  gross: number;
  hoursPaid: number;
  overtimeHours: number;
  reductionApplied: number;
  siret: string | null;
  contractType: string | null;
}
export interface AtRateFieldValue { siret: string | null; year: number; rate: number }

export interface ExtractedFieldDraft {
  fieldKey: 'ligne_paie' | 'taux_at_notifie';
  value: PayrollFieldValue | AtRateFieldValue;
  page: number | null;
  zone: Record<string, unknown> | null;
  confidence: number;
  extractor: string;
  year: number | null;
}

export interface ExtractionResult {
  documentType: 'dsn' | 'journal_paie' | 'notification_at' | 'bulletin_paie' | 'contrat_apprentissage' | 'justificatif_aide' | 'liasse_fiscale' | 'inconnu';
  classificationConfidence: number;
  fields: ExtractedFieldDraft[];
  notes: string[];
  /** true : aucune extraction automatique possible, saisie manuelle à partir du document. */
  manualEntryRequired: boolean;
}
