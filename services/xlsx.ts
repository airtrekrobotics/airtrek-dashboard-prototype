// Minimal dependency-free .xlsx writer: builds a ZIP ("stored", no compression)
// of the Open XML parts and triggers a browser download. Cells use inline
// strings, so no shared-strings table is needed.

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

const buildZip = (files: { name: string; content: string }[]): Uint8Array => {
  const parts: number[] = [];
  const central: number[] = [];
  let offset = 0;
  const write = (arr: number[] | Uint8Array) => {
    for (let i = 0; i < arr.length; i++) parts.push(arr[i]);
    offset += arr.length;
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const localOffset = offset;
    write(u32(0x04034b50));
    write([...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0)]); // ver, flags, method=stored, time, date
    write(u32(crc));
    write(u32(data.length)); // compressed size
    write(u32(data.length)); // uncompressed size
    write([...u16(name.length), ...u16(0)]); // name len, extra len
    write(name);
    write(data);

    central.push(
      ...u32(0x02014b50),
      ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(localOffset),
      ...name,
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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pure numeric strings become real number cells; everything else is text.
const isNum = (v: string) => v !== '' && /^-?\d+(\.\d+)?$/.test(v);

const colRef = (i: number): string => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export const downloadXlsx = (filename: string, headers: string[], rows: string[][]) => {
  const sheetData = [headers, ...rows]
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colRef(c)}${r + 1}`;
          const val = v ?? '';
          return isNum(val)
            ? `<c r="${ref}"><v>${val}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const files = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Mission Logs" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${sheetData}</sheetData></worksheet>`,
    },
  ];

  const blob = new Blob([buildZip(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
