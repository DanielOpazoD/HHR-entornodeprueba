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
  frameOfReference = '1.2.826.0.1.3680043.10.543.3'
): Uint8Array => {
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
  element('00020002', 'UI', '1.2.840.10008.5.1.4.1.1.2');
  element('00020003', 'UI', sop);
  element('00020010', 'UI', jpeg2000 ? '1.2.840.10008.1.2.4.90' : '1.2.840.10008.1.2.1');
  element('00020012', 'UI', '1.2.826.0.1.3680043.10.543.99');
  element('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.2');
  element('00080018', 'UI', sop);
  element('00080060', 'CS', 'CT');
  element('00100010', 'PN', 'PACIENTE^SINTETICO');
  element('00100020', 'LO', patientId);
  element('00180050', 'DS', '2');
  element('0020000d', 'UI', SYNTHETIC_STUDY_UID);
  element('0020000e', 'UI', SYNTHETIC_SERIES_UID);
  element('00200013', 'IS', String(slice + 1));
  element('00200032', 'DS', `0\\0\\${slice * 2}`);
  element('00200037', 'DS', '1\\0\\0\\0\\1\\0');
  element('00200052', 'UI', frameOfReference);
  element('00280002', 'US', 1);
  element('00280004', 'CS', 'MONOCHROME2');
  element('00280010', 'US', 64);
  element('00280011', 'US', 64);
  element('00280030', 'DS', '1\\1');
  element('00280100', 'US', 16);
  element('00280101', 'US', 16);
  element('00280102', 'US', 15);
  element('00280103', 'US', jpeg2000 ? 0 : 1);
  element('00281050', 'DS', '40');
  element('00281051', 'DS', '400');
  element('00281052', 'DS', jpeg2000 ? '-1024' : '0');
  element('00281053', 'DS', '1');
  const pixels = new Uint8Array(64 * 64 * 2);
  const pixelView = new DataView(pixels.buffer);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const distance =
        ((x - 32) / 24) ** 2 + ((y - 32) / 20) ** 2 + ((slice - count / 2) / (count / 2)) ** 2;
      const value = distance < 0.2 ? 950 : distance < 1 ? 60 : -1000;
      pixelView.setInt16((y * 64 + x) * 2, value, true);
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
