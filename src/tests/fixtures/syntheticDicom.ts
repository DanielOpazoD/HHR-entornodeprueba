/** Entirely generated geometry and pixels. Never derived from a patient or HAR. */
export const SYNTHETIC_STUDY_UID = '1.2.826.0.1.3680043.10.543.1';
export const SYNTHETIC_SERIES_UID = '1.2.826.0.1.3680043.10.543.2';
export const SYNTHETIC_PATIENT_ID = '111111111';
export const syntheticSopUid = (slice: number) => `1.2.826.0.1.3680043.10.543.4.${slice + 1}`;

export const syntheticDicom = (
  slice: number,
  count = 24,
  patientId = SYNTHETIC_PATIENT_ID,
  jpeg2000?: Uint8Array,
  frameOfReference = '1.2.826.0.1.3680043.10.543.3',
  matrix?: {
    rows: number;
    columns: number;
    spacing: [number, number];
    position: [number, number];
    padding?: boolean;
    functionalGroupMapping?: boolean;
  },
  plane?: { imageType?: string; orientation?: number[]; modality?: string; sopClass?: string }
): Uint8Array => {
  const rows = matrix?.rows ?? 64;
  const columns = matrix?.columns ?? 64;
  const spacing = matrix?.spacing ?? [1, 1];
  const position = matrix?.position ?? [0, 0];
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const element = (tag: string, vr: string, value: string | number | Uint8Array) => {
    let data =
      typeof value === 'string'
        ? encoder.encode(value)
        : typeof value === 'number'
          ? new Uint8Array([value & 255, value >> 8])
          : value;
    if (data.length % 2) {
      const padded = new Uint8Array(data.length + 1);
      padded.set(data);
      padded[data.length] = vr === 'UI' ? 0 : 32;
      data = padded;
    }
    const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
    const header = new Uint8Array(long ? 12 : 8);
    const view = new DataView(header.buffer);
    view.setUint16(0, parseInt(tag.slice(0, 4), 16), true);
    view.setUint16(2, parseInt(tag.slice(4), 16), true);
    header.set(encoder.encode(vr), 4);
    if (long) view.setUint32(8, data.length, true);
    else view.setUint16(6, data.length, true);
    parts.push(header, data);
  };
  const sop = syntheticSopUid(slice);
  const sopClass =
    plane?.sopClass ??
    (matrix?.functionalGroupMapping ? '1.2.840.10008.5.1.4.1.1.2.1' : '1.2.840.10008.5.1.4.1.1.2');
  element('00020002', 'UI', sopClass);
  element('00020003', 'UI', sop);
  element('00020010', 'UI', jpeg2000 ? '1.2.840.10008.1.2.4.90' : '1.2.840.10008.1.2.1');
  element('00020012', 'UI', '1.2.826.0.1.3680043.10.543.99');
  if (plane?.imageType) element('00080008', 'CS', plane.imageType);
  element('00080016', 'UI', sopClass);
  element('00080018', 'UI', sop);
  element('00080060', 'CS', plane?.modality ?? 'CT');
  element('00100010', 'PN', 'PACIENTE^SINTETICO');
  element('00100020', 'LO', patientId);
  element('00180050', 'DS', '2');
  element('0020000d', 'UI', SYNTHETIC_STUDY_UID);
  element('0020000e', 'UI', SYNTHETIC_SERIES_UID);
  element('00200013', 'IS', String(slice + 1));
  element('00200032', 'DS', `${position[0]}\\${position[1]}\\${slice * 2}`);
  element('00200037', 'DS', (plane?.orientation ?? [1, 0, 0, 0, 1, 0]).join('\\'));
  element('00200052', 'UI', frameOfReference);
  element('00280002', 'US', 1);
  element('00280004', 'CS', 'MONOCHROME2');
  if (matrix?.functionalGroupMapping) element('00280008', 'IS', '1');
  element('00280010', 'US', rows);
  element('00280011', 'US', columns);
  element('00280030', 'DS', spacing.join('\\'));
  element('00280100', 'US', 16);
  element('00280101', 'US', 16);
  element('00280102', 'US', 15);
  element('00280103', 'US', jpeg2000 ? 0 : 1);
  if (matrix?.padding) element('00280120', 'SS', -2000);
  element('00281050', 'DS', '40');
  element('00281051', 'DS', '400');
  element('00281052', 'DS', jpeg2000 || matrix ? '-1024' : '0');
  element('00281053', 'DS', matrix ? '2' : '1');
  if (matrix?.functionalGroupMapping) {
    const sequence = (tag: string, body: () => void) => {
      const start = parts.length;
      body();
      const content = parts.splice(start);
      const length = content.reduce((sum, part) => sum + part.length, 0);
      const item = new Uint8Array(8 + length);
      const view = new DataView(item.buffer);
      view.setUint16(0, 0xfffe, true);
      view.setUint16(2, 0xe000, true);
      view.setUint32(4, length, true);
      let offset = 8;
      for (const part of content) {
        item.set(part, offset);
        offset += part.length;
      }
      element(tag, 'SQ', item);
    };
    const fd = (value: number) => {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, value, true);
      return bytes;
    };
    sequence('52009229', () =>
      sequence('00409096', () => {
        element('00409224', 'FD', fd(100));
        element('00409225', 'FD', fd(3));
      })
    );
  }
  const pixels = new Uint8Array(rows * columns * 2);
  const pixelView = new DataView(pixels.buffer);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const distance =
        ((position[0] + x * spacing[1] - 32) / 24) ** 2 +
        ((position[1] + y * spacing[0] - 32) / 20) ** 2 +
        ((slice - count / 2) / (count / 2)) ** 2;
      const value = distance < 0.2 ? 950 : distance < 1 ? 60 : -1000;
      pixelView.setInt16((y * columns + x) * 2, matrix ? (value + 1024) / 2 : value, true);
    }
  if (jpeg2000) {
    const header = new Uint8Array(12);
    const view = new DataView(header.buffer);
    view.setUint16(0, 0x7fe0, true);
    view.setUint16(2, 0x0010, true);
    header.set(encoder.encode('OB'), 4);
    view.setUint32(8, 0xffffffff, true);
    const item = (length: number, delimiter = 0xe000) => {
      const result = new Uint8Array(8);
      const itemView = new DataView(result.buffer);
      itemView.setUint16(0, 0xfffe, true);
      itemView.setUint16(2, delimiter, true);
      itemView.setUint32(4, length, true);
      return result;
    };
    const even = new Uint8Array(jpeg2000.length + (jpeg2000.length % 2));
    even.set(jpeg2000);
    parts.push(header, item(0), item(even.length), even, item(0, 0xe0dd));
  } else element('7fe00010', 'OW', pixels);
  const output = new Uint8Array(132 + parts.reduce((sum, part) => sum + part.length, 0));
  output.set(encoder.encode('DICM'), 128);
  let offset = 132;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

export const syntheticVendorStudy = (count = 24) => ({
  studyInstanceUid: SYNTHETIC_STUDY_UID,
  patientId: 'synthetic-internal-portal-id',
  studyDate: '20261016',
  seriesList: [
    {
      seriesInstanceUid: SYNTHETIC_SERIES_UID,
      seriesNumber: 1,
      seriesDescription: 'Volumen sintético',
      modality: 'CT',
      instances: Array.from({ length: count }, (_, i) => {
        const nested = new URL('http://172.16.20.110:1000/wado/HHANGAROA');
        nested.search = new URLSearchParams({
          requestType: 'WADO',
          studyUID: SYNTHETIC_STUDY_UID,
          seriesUID: SYNTHETIC_SERIES_UID,
          objectUID: syntheticSopUid(i),
          contentType: 'application/dicom',
        }).toString();
        return {
          sopInstanceUid: syntheticSopUid(i),
          instanceNumber: i + 1,
          numberOfFrames: 1,
          rows: 64,
          columns: 64,
          modality: 'CT',
          wadouri: `https://hhangaroavisor.mmrad.cl:4446/__wado_proxy?${new URLSearchParams({ serverId: 'synthetic', url: nested.href })}`,
        };
      }),
    },
  ],
});
