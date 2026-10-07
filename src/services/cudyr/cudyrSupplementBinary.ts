import { read, utils } from 'xlsx';
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
export const parseCudyrSupplementBinary = (buffer: ArrayBuffer) => {
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
  const rows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
  return parseCudyrSupplementMatrix({ sheet: names[0], rows });
};
