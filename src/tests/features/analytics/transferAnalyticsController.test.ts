import { describe, expect, it } from 'vitest';

import {
  buildTransferAnalytics,
  resolveTransferAnalyticsCategory,
} from '@/features/analytics/controllers/transferAnalyticsController';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { TransferData } from '@/types/domain/movements';

const createTransfer = (
  id: string,
  evacuationMethod: string,
  evacuationMethodOther?: string,
  deletedAt?: string
): TransferData => ({
  id,
  bedName: 'R1',
  bedId: 'R1',
  bedType: 'Cama',
  patientName: `Paciente ${id}`,
  rut: '',
  diagnosis: 'Diagnóstico',
  time: '10:00',
  evacuationMethod,
  evacuationMethodOther,
  receivingCenter: 'Hospital Salvador',
  deletedAt,
});

const createRecord = (date: string, transfers: TransferData[]): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers,
    cma: [],
  }) as DailyRecord;

describe('transferAnalyticsController', () => {
  it('recognizes LATAM and air-ambulance operators from canonical and free-text records', () => {
    expect(resolveTransferAnalyticsCategory(createTransfer('1', 'Avión comercial'))).toBe('latam');
    expect(resolveTransferAnalyticsCategory(createTransfer('2', 'Otro', 'Vuelo LATAM'))).toBe(
      'other_air_ambulance'
    );
    expect(resolveTransferAnalyticsCategory(createTransfer('3', 'Aerocardal'))).toBe('aerocardal');
    expect(resolveTransferAnalyticsCategory(createTransfer('4', 'Avión FACH'))).toBe('fach');
    expect(resolveTransferAnalyticsCategory(createTransfer('5', 'Otro', 'Avión Armada'))).toBe(
      'armada'
    );
    expect(
      resolveTransferAnalyticsCategory(
        createTransfer('6', 'Otro', 'Ambulancia aérea empresa privada')
      )
    ).toBe('other_air_ambulance');
    expect(resolveTransferAnalyticsCategory(createTransfer('8', 'Otro'))).toBe(
      'other_air_ambulance'
    );
    expect(resolveTransferAnalyticsCategory(createTransfer('7', 'Barco'))).toBe('other');
  });

  it('builds exclusive percentages, provider breakdown and daily totals', () => {
    const analysis = buildTransferAnalytics([
      createRecord('2026-03-10', [
        createTransfer('1', 'Avión comercial'),
        createTransfer('2', 'Aerocardal'),
        createTransfer('3', 'Avión FACH'),
      ]),
      createRecord('2026-03-11', [
        createTransfer('4', 'Otro', 'Avión Armada'),
        createTransfer('5', 'Otro', 'Servicio de aeroevacuación privado'),
        createTransfer('6', 'Barco'),
        createTransfer('deleted', 'Aerocardal', undefined, '2026-03-12T00:00:00.000Z'),
      ]),
    ]);

    expect(analysis).toMatchObject({
      totalTransfers: 6,
      latam: 1,
      airAmbulance: 4,
      other: 1,
      latamPercent: 16.7,
      airAmbulancePercent: 66.7,
      otherPercent: 16.7,
      daily: [
        {
          date: '2026-03-10',
          total: 3,
          latam: 1,
          aerocardal: 1,
          armedForces: 1,
          other: 0,
        },
        {
          date: '2026-03-11',
          total: 3,
          latam: 0,
          aerocardal: 0,
          armedForces: 1,
          other: 2,
        },
      ],
    });
    expect(analysis.providers).toMatchObject([
      { key: 'aerocardal', count: 1, percentOfAirAmbulance: 25 },
      { key: 'fach', count: 1, percentOfAirAmbulance: 25 },
      { key: 'armada', count: 1, percentOfAirAmbulance: 25 },
      { key: 'other_air_ambulance', count: 1, percentOfAirAmbulance: 25 },
    ]);
    expect(analysis.details.find(detail => detail.id === '5')).toMatchObject({
      evacuationMethod: 'Otro',
      evacuationMethodOther: 'Servicio de aeroevacuación privado',
      category: 'other_air_ambulance',
    });
  });
});
