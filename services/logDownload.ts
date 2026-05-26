import { TowLog } from '../types';
import { buildLogPdf } from './pdf';

// Minimal ZIP ("stored", no compression) for arbitrary binary entries.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const enc = new TextEncoder();
const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

const buildZip = (files: { name: string; data: Uint8Array }[]): Uint8Array => {
  const parts: number[] = [];
  const central: number[] = [];
  let offset = 0;
  const write = (arr: number[] | Uint8Array) => {
    for (let i = 0; i < arr.length; i++) parts.push(arr[i]);
    offset += arr.length;
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const localOffset = offset;
    write(u32(0x04034b50));
    write([...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0)]);
    write(u32(crc));
    write(u32(f.data.length));
    write(u32(f.data.length));
    write([...u16(name.length), ...u16(0)]);
    write(name);
    write(f.data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(localOffset), ...name,
    );
  }

  const cdStart = offset;
  write(central);
  write([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(cdStart), ...u16(0),
  ]);
  return new Uint8Array(parts);
};

// Build and download a per-mission package: a PDF report + three (empty,
// placeholder) sensor video files, zipped together.
export const downloadLogPackage = async (log: TowLog) => {
  const slug = `${log.tailNumber}-${log.dateTime.replace(/[: ]/g, '-')}`;
  const files = [
    { name: `mission-report-${log.tailNumber}.pdf`, data: await buildLogPdf(log) },
    { name: 'LEFT WING.mp4', data: new Uint8Array(0) },
    { name: 'RIGHT WING.mp4', data: new Uint8Array(0) },
    { name: 'SENSOR OVERLAY.mp4', data: new Uint8Array(0) },
  ];
  const blob = new Blob([buildZip(files)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mission-${slug}.zip`;
  a.click();
  URL.revokeObjectURL(url);
};
