import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import * as React from 'react';
import type { ReportData, ReportSection } from './report-data';

/** Polices standard PDF (WinAnsi) : on remplace les espaces insécables fines et autres caractères hors jeu. */
const clean = (s: string) => s.replace(/[   ]/g, ' ').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[→]/g, '->');

const NAVY = '#0b1f3a';
const BRAND = '#1d4ed8';
const MONEY = '#15803d';
const MUTED = '#5b6b80';
const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: NAVY, lineHeight: 1.35 },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6, color: BRAND },
  h3: { fontSize: 10.5, fontFamily: 'Helvetica-Bold' },
  muted: { color: MUTED },
  demo: { marginTop: 8, padding: 6, backgroundColor: '#fef3c7', color: '#78350f' },
  cards: { flexDirection: 'row', gap: 8, marginTop: 12 },
  card: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 8 },
  cardLabel: { fontSize: 8, color: MUTED, textTransform: 'uppercase' },
  cardValue: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 2.5 },
  cellK: { width: '38%', color: MUTED, paddingRight: 6 },
  cellV: { width: '62%' },
  item: { flexDirection: 'row', marginBottom: 2 },
  opp: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 8, marginBottom: 8 },
  amount: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: MONEY, marginTop: 3 },
  disclaimer: { marginTop: 16, padding: 8, backgroundColor: '#f5f7fa', fontSize: 8.5 },
  footer: { position: 'absolute', bottom: 18, left: 36, right: 36, fontSize: 7.5, color: MUTED, flexDirection: 'row', justifyContent: 'space-between' },
});

function Rows({ rows }: { rows: [string, string][] }) {
  return <>{rows.map(([k, v], i) => <View key={i} style={s.row}><Text style={s.cellK}>{clean(k)}</Text><Text style={s.cellV}>{clean(v)}</Text></View>)}</>;
}
function Items({ items }: { items: string[] }) {
  return <>{items.map((it, i) => <View key={i} style={s.item}><Text>•  </Text><Text style={{ flex: 1 }}>{clean(it)}</Text></View>)}</>;
}
function Section({ section }: { section: ReportSection }) {
  return (
    <View>
      <Text style={s.h2}>{clean(section.title)}</Text>
      {section.paragraphs?.map((p, i) => <Text key={i} style={{ marginBottom: 4 }}>{clean(p)}</Text>)}
      {section.rows && <Rows rows={section.rows} />}
      {section.items && <Items items={section.items} />}
    </View>
  );
}

function Footer({ text }: { text: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{clean(text)}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <Document title={clean(`${data.title} – ${data.companyLine}`)} author="Récupération PME" language="fr-FR">
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{clean(data.title)}</Text>
        <Text style={{ fontSize: 12, marginTop: 4 }}>{clean(data.companyLine)}</Text>
        <Text style={s.muted}>{clean(data.generatedLine)}</Text>
        {data.demoBanner && <Text style={s.demo}>{clean(data.demoBanner)}</Text>}
        <View style={s.cards}>
          <View style={s.card}><Text style={s.cardLabel}>1. Récupération passée estimée</Text><Text style={[s.cardValue, { color: MONEY }]}>{clean(data.indicators.past)}</Text></View>
          <View style={s.card}><Text style={s.cardLabel}>2. Commission indicative</Text><Text style={s.cardValue}>{clean(data.indicators.commission)}</Text><Text style={s.muted}>{clean(`Gain net : ${data.indicators.netGain}`)}</Text></View>
          <View style={s.card}><Text style={s.cardLabel}>3. Économies futures (offertes)</Text><Text style={[s.cardValue, { color: BRAND }]}>{clean(data.indicators.future)}</Text></View>
        </View>
        <Text style={s.disclaimer}>{clean(data.disclaimer)}</Text>
        {data.sections.slice(0, 2).map((sec) => <Section key={sec.title} section={sec} />)}
        <Footer text={data.footer} />
      </Page>
      <Page size="A4" style={s.page}>
        <Text style={[s.h2, { marginTop: 0 }]}>Opportunités et calculs</Text>
        {data.opportunities.map((o, i) => (
          <View key={i} style={s.opp}>
            <Text style={s.h3}>{clean(o.title)}</Text>
            <Text style={s.muted}>{clean(`${o.subtitle} · ${o.status} · ${o.confidenceRisk}`)}</Text>
            <Text style={s.amount}>{clean(o.amount)}</Text>
            <Text style={{ marginTop: 3 }}>{clean(o.explanation)}</Text>
            {o.conditions.length > 0 && <><Text style={[s.h3, { marginTop: 4 }]}>Conditions</Text><Items items={o.conditions} /></>}
            {o.calculation.length > 0 && <><Text style={[s.h3, { marginTop: 4 }]}>Détail du calcul</Text><Rows rows={o.calculation} /></>}
            {o.hypotheses.length > 0 && <><Text style={[s.h3, { marginTop: 4 }]}>Hypothèses</Text><Items items={o.hypotheses} /></>}
            {o.missing.length > 0 && <><Text style={[s.h3, { marginTop: 4 }]}>Informations manquantes</Text><Items items={o.missing} /></>}
            {o.sources.length > 0 && <><Text style={[s.h3, { marginTop: 4 }]}>Sources</Text><Items items={o.sources} /></>}
          </View>
        ))}
        <Footer text={data.footer} />
      </Page>
      <Page size="A4" style={s.page}>
        {data.sections.slice(2).map((sec) => <Section key={sec.title} section={sec} />)}
        <Text style={s.disclaimer}>{clean(data.disclaimer)}</Text>
        <Footer text={data.footer} />
      </Page>
    </Document>
  );
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} />);
}
