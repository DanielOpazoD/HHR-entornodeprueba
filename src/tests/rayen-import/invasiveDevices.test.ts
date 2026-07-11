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

  // Real dump (Hugo Zamora, encId 141225): the two-column PDF interleaves the medicamentos /
  // indicaciones text with the devices table by y. Those lines land at the nombre column with
  // "Programad"/"a" in the fecha column — they must NOT be captured as devices; only the VVP is.
  const INTERLEAVED_LAYOUT: DeviceTextItem[] = [
    item(22, 650, 'DISPOSITIVOS'),
    item(91, 650, 'Nombre'),
    item(251, 650, 'Ubicación'),
    item(351, 650, 'Nro.'),
    item(391, 650, 'Fecha instalación'),
    item(491, 650, 'Fecha expiración'),
    item(72, 641, '- 1 comprimido SOS si'),
    item(421, 641, 'Programad'),
    item(20, 640, 'INVASIVOS:'),
    item(91, 638, 'Vía Venosa Periférica'),
    item(251, 638, 'ESD'),
    item(351, 638, '20.0'),
    item(391, 638, '9/07/26 23:15'),
    item(491, 638, '12/07/26 0:00'),
    item(72, 632, 'agitacion (segundo SOS)'),
    item(421, 632, 'a'),
    item(20, 617, 'SIGNOS VITALES Ariki Merino - Médico'),
  ];

  it('ignores interleaved medication/indicaciones text, keeping only the real device', () => {
    expect(parseInvasiveDevices(INTERLEAVED_LAYOUT)).toEqual([
      {
        nombre: 'Vía Venosa Periférica',
        ubicacion: 'ESD',
        nro: '20.0',
        fechaInstalacion: '9/07/26 23:15',
        fechaExpiracion: '12/07/26 0:00',
      },
    ]);
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
