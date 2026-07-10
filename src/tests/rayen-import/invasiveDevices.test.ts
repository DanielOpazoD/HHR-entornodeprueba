import { describe, expect, it } from 'vitest';
import {
  parseInvasiveDevices,
  mapInvasiveDevices,
  type DeviceTextItem,
  type InvasiveDeviceRow,
} from '@/features/rayen-import';

const item = (x: number, y: number, str: string): DeviceTextItem => ({ x, y, str });

// The real x/y coordinates dumped from a live Resumen_diario_paciente.pdf (Foley patient).
const REAL_LAYOUT: DeviceTextItem[] = [
  item(22, 314, 'DISPOSITIVOS'),
  item(91, 314, 'Nombre'),
  item(251, 314, 'Ubicación'),
  item(351, 314, 'Nro.'),
  item(391, 314, 'Fecha instalación'),
  item(491, 314, 'Fecha expiración'),
  item(20, 304, 'INVASIVOS:'),
  item(91, 302, 'Sonda vesical permanente'),
  item(251, 302, 'Zona genital'),
  item(351, 302, '14.0'),
  item(391, 302, '29/06/26 10:32'),
  item(491, 302, '9/08/26 0:00'),
  item(20, 281, 'SIGNOS VITALES Francisca Orellana - Paramédico'),
];

describe('parseInvasiveDevices', () => {
  it('reconstructs the device row from the positional PDF layout', () => {
    expect(parseInvasiveDevices(REAL_LAYOUT)).toEqual([
      {
        nombre: 'Sonda vesical permanente',
        ubicacion: 'Zona genital',
        nro: '14.0',
        fechaInstalacion: '29/06/26 10:32',
        fechaExpiracion: '9/08/26 0:00',
      },
    ]);
  });

  it('skips the wrapped "INVASIVOS:" label and stops at SIGNOS VITALES', () => {
    expect(parseInvasiveDevices(REAL_LAYOUT)).toHaveLength(1);
  });

  it('returns [] when there is no devices table', () => {
    expect(parseInvasiveDevices([item(20, 281, 'SIGNOS VITALES')])).toEqual([]);
  });
});

describe('mapInvasiveDevices', () => {
  it('maps Sonda vesical → CUP with ISO install date + expiration note', () => {
    expect(mapInvasiveDevices(parseInvasiveDevices(REAL_LAYOUT))).toEqual([
      {
        type: 'CUP',
        installationDate: '2026-06-29',
        installationTime: '10:32',
        location: 'Zona genital',
        note: 'Vence: 9/08/26 0:00',
      },
    ]);
  });

  it('maps CVC and numbers multiple VVPs #1/#2', () => {
    const rows: InvasiveDeviceRow[] = [
      {
        nombre: 'Catéter venoso central',
        ubicacion: 'Subclavia D',
        nro: '',
        fechaInstalacion: '01/07/2026 08:00',
        fechaExpiracion: '',
      },
      {
        nombre: 'Vía venosa periférica',
        ubicacion: 'Antebrazo D',
        nro: '',
        fechaInstalacion: '02/07/2026 09:15',
        fechaExpiracion: '',
      },
      {
        nombre: 'Vía venosa periférica',
        ubicacion: 'Antebrazo I',
        nro: '',
        fechaInstalacion: '02/07/2026 10:00',
        fechaExpiracion: '',
      },
    ];
    const mapped = mapInvasiveDevices(rows);
    expect(mapped.map(m => m.type)).toEqual(['CVC', 'VVP#1', 'VVP#2']);
    expect(mapped[0]).toMatchObject({ installationDate: '2026-07-01', installationTime: '08:00' });
  });
});
