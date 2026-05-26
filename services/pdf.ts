import { TowLog } from '../types';
import { renderTrajectoryJpeg, RenderedImage } from './trajectoryImage';

const enc = new TextEncoder();

const escapePdf = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Build a single-page PDF: title, optional trajectory image, then text fields.
// Assembled as bytes so the (binary) JPEG image stream can be embedded.
export const buildLogPdf = async (log: TowLog): Promise<Uint8Array> => {
  let image: RenderedImage | null = null;
  try {
    image = await renderTrajectoryJpeg(log);
  } catch {
    image = null; // fall back to a text-only report if the map can't render
  }

  const d = log.details;
  const fields = [
    `Tail Number: ${log.tailNumber}`,
    `Date / Time: ${log.dateTime}`,
    `Operator: ${log.operator}`,
    `Tug: ${log.tug}`,
    `Status: ${log.status}`,
    `Assigned Route: ${d?.path ?? ''}`,
    `Total Distance: ${d?.distance ?? ''}`,
    `Max Velocity: ${d?.maxSpeed ?? ''}`,
    `Events Detected: ${d?.events ?? 0}`,
    `Battery (End): ${d?.batteryEnd ?? ''}`,
  ];

  const imgW = 500;
  const imgH = image ? Math.round((imgW * image.height) / image.width) : 0;
  const imgY = 748 - imgH; // image top at y=748
  const lh = 22;
  const textTop = image ? imgY - 34 : 720;

  const ops: string[] = [];
  ops.push(`BT /F1 17 Tf 1 0 0 1 56 766 Tm (${escapePdf('AIRTREK ROBOTICS - Mission Report')}) Tj ET`);
  if (image) ops.push(`q ${imgW} 0 0 ${imgH} 56 ${imgY} cm /Im0 Do Q`);
  fields.forEach((t, i) => {
    ops.push(`BT /F1 12 Tf 1 0 0 1 56 ${textTop - i * lh} Tm (${escapePdf(t)}) Tj ET`);
  });
  const content = ops.join('\n');

  const resources = image
    ? '<< /Font << /F1 4 0 R >> /XObject << /Im0 6 0 R >> >>'
    : '<< /Font << /F1 4 0 R >> >>';
  const objCount = image ? 6 : 5;

  const chunks: Uint8Array[] = [];
  let len = 0;
  const offsets: number[] = [];
  const pushS = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    len += b.length;
  };
  const pushB = (b: Uint8Array) => {
    chunks.push(b);
    len += b.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = len;
    pushS(`${n} 0 obj\n${body}\nendobj\n`);
  };

  pushS('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents 5 0 R >>`);
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  if (image) {
    offsets[6] = len;
    pushS(
      `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
    );
    pushB(image.bytes);
    pushS('\nendstream\nendobj\n');
  }

  const xref = len;
  pushS(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objCount; i++) pushS(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  pushS(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const out = new Uint8Array(len);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
};
