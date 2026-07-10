/**
 * Positional parser for the "DISPOSITIVOS INVASIVOS" table of the Ficha Médico daily-summary
 * PDF (`Resumen_diario_paciente.pdf`). The extension downloads the PDF; HHR extracts its text
 * items with pdfjs (each carries an x/y from `transform`), and this pure function reconstructs
 * the table by grouping items into rows (by y) and columns (by x). Confirmed against a real PDF.
 *
 * Layout (x-anchors): Nombre @~91 · Ubicación @~251 · Nro. @~351 · Fecha instalación @~391 ·
 * Fecha expiración @~491. Device rows sit just below the header, above the "SIGNOS VITALES"
 * section; the wrapped "INVASIVOS:" label is skipped.
 */

/** One text fragment from the PDF: `x`/`y` are pdfjs `transform[4]`/`transform[5]`. */
export interface DeviceTextItem {
  x: number;
  y: number;
  str: string;
}

/** One raw device row as printed in the report. */
export interface InvasiveDeviceRow {
  nombre: string;
  ubicacion: string;
  nro: string;
  /** Install datetime as printed, e.g. "29/06/26 10:32". */
  fechaInstalacion: string;
  /** Expiration datetime as printed, e.g. "9/08/26 0:00". */
  fechaExpiracion: string;
}

const norm = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

interface Cell {
  x: number;
  s: string;
}
interface Line {
  y: number;
  cells: Cell[];
}

export const parseInvasiveDevices = (items: DeviceTextItem[]): InvasiveDeviceRow[] => {
  // Group fragments into lines by rounded y; cells sorted left→right.
  const byY = new Map<number, Cell[]>();
  for (const item of items) {
    const s = String(item.str || '').trim();
    if (!s) continue;
    const y = Math.round(item.y);
    const row = byY.get(y) ?? [];
    row.push({ x: item.x, s });
    byY.set(y, row);
  }
  const lines: Line[] = [...byY.entries()]
    .map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y); // top→bottom

  const headerIdx = lines.findIndex(line => {
    const joined = norm(line.cells.map(c => c.s).join(' '));
    return joined.includes('nombre') && joined.includes('fecha instalacion');
  });
  if (headerIdx < 0) return [];

  // Column x-anchors from the header cells.
  type Col = 'nombre' | 'ubicacion' | 'nro' | 'fechaInstalacion' | 'fechaExpiracion';
  const anchors: Array<[Col, number]> = [];
  for (const cell of lines[headerIdx].cells) {
    const n = norm(cell.s);
    if (n.includes('nombre')) anchors.push(['nombre', cell.x]);
    else if (n.includes('ubicaci')) anchors.push(['ubicacion', cell.x]);
    else if (n.includes('nro')) anchors.push(['nro', cell.x]);
    else if (n.includes('instalacion')) anchors.push(['fechaInstalacion', cell.x]);
    else if (n.includes('expiracion')) anchors.push(['fechaExpiracion', cell.x]);
  }
  const nombreX = anchors.find(a => a[0] === 'nombre')?.[1] ?? 0;
  const nearestCol = (x: number): Col =>
    anchors.reduce((best, a) => (Math.abs(a[1] - x) < Math.abs(best[1] - x) ? a : best))[0];

  const devices: InvasiveDeviceRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const joined = norm(line.cells.map(c => c.s).join(' '));
    if (joined.includes('signos vitales') || joined.startsWith('pag.')) break; // next section
    if (joined === 'invasivos:' || joined.startsWith('invasivos')) continue; // wrapped title label

    const row: Record<Col, string> = {
      nombre: '',
      ubicacion: '',
      nro: '',
      fechaInstalacion: '',
      fechaExpiracion: '',
    };
    for (const cell of line.cells) {
      const col = nearestCol(cell.x);
      row[col] = row[col] ? `${row[col]} ${cell.s}` : cell.s;
    }
    const startsAtNombre = Math.abs((line.cells[0]?.x ?? 1e9) - nombreX) < 60;
    if (startsAtNombre && row.nombre && (row.fechaInstalacion || row.fechaExpiracion)) {
      devices.push({
        nombre: row.nombre.trim(),
        ubicacion: row.ubicacion.trim(),
        nro: row.nro.trim(),
        fechaInstalacion: row.fechaInstalacion.trim(),
        fechaExpiracion: row.fechaExpiracion.trim(),
      });
    }
  }
  return devices;
};
