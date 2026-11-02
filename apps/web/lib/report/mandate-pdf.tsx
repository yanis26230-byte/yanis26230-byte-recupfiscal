import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import * as React from 'react';

const clean = (s: string) => s.replace(/[   ]/g, ' ');
const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'Helvetica', color: '#0b1f3a', lineHeight: 1.45 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  box: { marginTop: 24, borderWidth: 1, borderColor: '#94a3b8', height: 80, padding: 8, width: 260 },
});

export interface MandateData {
  mandateId: string; companyName: string; siren: string; signerName: string; signerFunction: string; signerEmail: string;
  commissionRatePct: string; termsTitle: string; termsVersion: number; termsBody: string; auditRunId: string; createdOn: string;
}

export function renderMandatePdf(d: MandateData): Promise<Buffer> {
  return renderToBuffer(
    <Document title={clean(`Mandat – ${d.companyName}`)} language="fr-FR">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Mandat de récupération</Text>
        <Text>{clean(`Mandant : ${d.companyName} (SIREN ${d.siren}), représentée par ${d.signerName}, ${d.signerFunction} (${d.signerEmail}), qui déclare être habilité(e) à engager l’entreprise.`)}</Text>
        <Text style={s.h2}>Rémunération</Text>
        <Text>{clean(`Commission de ${d.commissionRatePct} portant uniquement sur les sommes rétroactives réellement remboursées et encaissées par le mandant. Aucune somme n’est due si rien n’est récupéré. Aucune facturation sur une estimation.`)}</Text>
        <Text style={s.h2}>{clean(`Conditions (${d.termsTitle}, version ${d.termsVersion})`)}</Text>
        <Text>{clean(d.termsBody)}</Text>
        <Text style={s.h2}>Références</Text>
        <Text>{clean(`Mandat ${d.mandateId} · estimation (calcul ${d.auditRunId}) · établi le ${d.createdOn}.`)}</Text>
        <View style={s.box}><Text>Signature électronique du mandant</Text></View>
      </Page>
    </Document>,
  );
}
