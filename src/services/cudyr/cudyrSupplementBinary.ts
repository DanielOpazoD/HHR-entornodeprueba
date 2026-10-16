import { read, utils, SSF } from 'xlsx';
import { parseCudyrSupplementMatrix } from './cudyrSupplementParser';

/** Reject ZIP expansions before SheetJS allocates decompressed data. BIFF uses bounded file bytes. */
const validateZip = (bytes: Uint8Array) => {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Archivo ZIP incompleto.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let expanded = 0;
  if (count > 200) throw new Error('Demasiados elementos en el archivo.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Estructura ZIP no admitida.');
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 8 * 1024 * 1024) throw new Error('El contenido descomprimido supera 8 MiB.');
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
};
export const readCudyrWorkbookMatrix = (buffer: ArrayBuffer, normalizeDateEpoch = false) => {
  if (buffer.byteLength > 262144 || buffer.byteLength < 8)
    throw new Error('Use un XLS/XLSX de hasta 256 KiB.');
  const signature = Array.from(new Uint8Array(buffer, 0, 8))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  if (signature !== 'd0cf11e0a1b11ae1' && !signature.startsWith('504b0304'))
    throw new Error('El archivo no es XLS/XLSX.');
  validateZip(new Uint8Array(buffer));
  const book = read(buffer, {
    type: 'array',
    cellFormula: true,
    cellDates: false,
    cellStyles: normalizeDateEpoch,
    cellNF: normalizeDateEpoch,
    sheetRows: 5001,
  });
  const names = book.SheetNames.filter(name => book.Sheets[name]['!ref']);
  if (names.length !== 1) throw new Error('El informe debe contener una sola hoja con datos.');
  const sheet = book.Sheets[names[0]];
  const range = utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if (range.e.r >= 5000 || range.e.c >= 100)
    throw new Error('El informe supera el límite de filas o columnas.');
  for (const [key, cell] of Object.entries(sheet))
    if (!key.startsWith('!') && cell?.f)
      throw new Error('No se admiten fórmulas en el informe fuente.');
  // Combined exports use the 1900 epoch; numeric non-date cells remain untouched.
  if (normalizeDateEpoch && book.Workbook?.WBProps?.date1904)
    for (const [key, cell] of Object.entries(sheet)) {
      const format = (cell?.z || '').replace(/"[^"]*"|\\.|_.|\*./g, '');
      const calendar =
        /[yd]|m{3}/i.test(format.replace(/\[[^\]]*\]/g, '')) ||
        (/m/i.test(format) && !/[hs]|\[[hms]+\]/i.test(format));
      if (
        !key.startsWith('!') &&
        typeof cell?.v === 'number' &&
        SSF.is_date(cell.z || '') &&
        calendar
      )
        cell.v += 1462;
    }
  // SheetJS sheet_to_json converts formatted serials into local Date objects even
  // with raw:true. Source copies must keep numeric dates and durations as serials.
  const rows = normalizeDateEpoch
    ? Array.from({ length: range.e.r + 1 }, (_, r) =>
        Array.from({ length: range.e.c + 1 }, (_, c) => {
          const cell = sheet[utils.encode_cell({ r, c })];
          return cell?.t === 'e' ? cell.w || '' : (cell?.v ?? '');
        })
      )
    : utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: '',
        blankrows: true,
      });
  return {
    sheet: names[0],
    rows,
    formats: Object.fromEntries(
      Object.entries(sheet)
        .filter(([key, cell]) => !key.startsWith('!') && cell?.z)
        .map(([key, cell]) => [key, cell.z as string])
    ),
    merges: (sheet['!merges'] || []).map(merge => {
      if (merge.s.r < 0 || merge.s.c < 0 || merge.e.r >= 5000 || merge.e.c >= 100)
        throw new Error('El informe contiene una combinación fuera de límites.');
      return utils.encode_range(merge);
    }),
    widths: (sheet['!cols'] || []).map(column => column?.wch),
    heights: (sheet['!rows'] || []).map(row => row?.hpt),
  };
};

export const parseCudyrSupplementBinary = (buffer: ArrayBuffer) =>
  parseCudyrSupplementMatrix(readCudyrWorkbookMatrix(buffer));
