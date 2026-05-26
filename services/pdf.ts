import { TowLog } from '../types';

const enc = new TextEncoder();

const escapePdf = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Minimal single-page PDF (Helvetica text only), no dependencies.
const buildPdf = (lines: { text: string; size: number }[]): Uint8Array => {
  const top = 740;
  const lh = 26;
  const content = lines
    .map((l, i) => `BT /F1 ${l.size} Tf 1 0 0 1 60 ${top - i * lh} Tm (${escapePdf(l.text)}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(enc.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = enc.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc.encode(pdf);
};

export const buildLogPdf = (log: TowLog): Uint8Array => {
  const d = log.details;
  const lines = [
    { text: 'AIRTREK ROBOTICS', size: 22 },
    { text: 'Wingwalking Mission Report', size: 13 },
    { text: '', size: 12 },
    { text: `Tail Number: ${log.tailNumber}`, size: 13 },
    { text: `Date / Time: ${log.dateTime}`, size: 13 },
    { text: `Operator: ${log.operator}`, size: 13 },
    { text: `Tug: ${log.tug}`, size: 13 },
    { text: `Status: ${log.status}`, size: 13 },
    { text: '', size: 12 },
    { text: `Assigned Route: ${d?.path ?? ''}`, size: 13 },
    { text: `Total Distance: ${d?.distance ?? ''}`, size: 13 },
    { text: `Max Velocity: ${d?.maxSpeed ?? ''}`, size: 13 },
    { text: `Events Detected: ${d?.events ?? 0}`, size: 13 },
    { text: `Battery (End): ${d?.batteryEnd ?? ''}`, size: 13 },
    { text: '', size: 12 },
    { text: 'Sensor footage: LEFT WING / RIGHT WING / SENSOR OVERLAY (see zip).', size: 10 },
  ];
  return buildPdf(lines);
};
