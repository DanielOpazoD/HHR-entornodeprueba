/**
 * Maps the raw invasive-device rows parsed from the Ficha Médico PDF to HHR device instances:
 * the Rayen device NAME → an HHR `DeviceType` (CUP = Sonda Foley, CVC, VVP#n, …), and the
 * printed install datetime → ISO date + HH:MM time. Expiration goes to the note (feeds the
 * "cambiar dispositivo" awareness). Multiple VVPs are numbered #1/#2/#3 in order.
 */

import type { InvasiveDeviceRow } from './parseInvasiveDevices';

export interface MappedDevice {
  /** HHR DeviceType: 'CUP' | 'CVC' | 'VVP#1'.. | 'LA' | 'VMNI' | 'CNAF' | 'TET' | raw name. */
  type: string;
  /** ISO YYYY-MM-DD, matching HHR's DeviceInstance.installationDate. */
  installationDate: string;
  /** HH:MM. */
  installationTime: string;
  location: string;
  /** Free note (carries the expiration date, when the report provides one). */
  note: string;
}

const norm = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Rayen device name → HHR base device type (VVP left unnumbered here; numbered by the caller). */
const baseType = (nombre: string): string => {
  const n = norm(nombre);
  if (/sonda vesical|foley|urinar|\bcup\b/.test(n)) return 'CUP';
  if (/cateter venoso central|venoso central|\bcvc\b/.test(n)) return 'CVC';
  if (/via venosa perif|venosa perif|perifer|\bvvp\b/.test(n)) return 'VVP';
  if (/linea arterial|\barterial\b|\bla\b/.test(n)) return 'LA';
  if (/canula nasal alto flujo|alto flujo|\bcnaf\b/.test(n)) return 'CNAF';
  if (/tubo endotraqueal|endotraqueal|\btet\b/.test(n)) return 'TET';
  if (/no invasiva|\bvmni\b/.test(n)) return 'VMNI';
  return nombre.trim(); // unknown → keep the raw printed name as a custom type
};

/** "29/06/26 10:32" → { date: '2026-06-29', time: '10:32' }. */
const parseInstall = (raw: string): { date: string; time: string } => {
  const match = String(raw || '').match(
    /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/
  );
  if (!match) return { date: '', time: '' };
  const [, d, mo, y, h, mi] = match;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const pad = (n: number | string): string => String(n).padStart(2, '0');
  return {
    date: `${year}-${pad(mo)}-${pad(d)}`,
    time: h != null && mi != null ? `${pad(h)}:${pad(mi)}` : '',
  };
};

export const mapInvasiveDevices = (rows: InvasiveDeviceRow[]): MappedDevice[] => {
  let vvpCount = 0;
  return rows
    .filter(row => row.nombre.trim().length > 0)
    .map(row => {
      const base = baseType(row.nombre);
      const type = base === 'VVP' ? `VVP#${Math.min(++vvpCount, 3)}` : base;
      const install = parseInstall(row.fechaInstalacion);
      return {
        type,
        installationDate: install.date,
        installationTime: install.time,
        location: row.ubicacion.trim(),
        note: row.fechaExpiracion.trim() ? `Vence: ${row.fechaExpiracion.trim()}` : '',
      };
    });
};
