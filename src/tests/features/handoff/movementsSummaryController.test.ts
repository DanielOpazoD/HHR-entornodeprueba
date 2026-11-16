// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isMovementInSelectedShift,
  filterDischargesByShift,
  filterTransfersByShift,
  filterCmaByShift,
  resolveMovementEmptyMessage,
  resolveTransferDestinationLabel,
  resolveTransferEscortLabel,
} from '@/features/handoff/controllers/movementsSummaryController';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const dayDischarge = { id: 'd1', time: '10:30' } as DischargeData;
const nightDischarge = { id: 'd2', time: '22:00' } as DischargeData;
const legacyDischarge = { id: 'd3' } as DischargeData; // no time field
const edgeDayEnd = { id: 'd4', time: '19:59' } as DischargeData;
const edgeNightStart = { id: 'd5', time: '20:00' } as DischargeData;
const earlyMorning = { id: 'd6', time: '06:30' } as DischargeData;

const dayTransfer = { id: 't1', time: '12:00' } as TransferData;
const nightTransfer = { id: 't2', time: '23:45' } as TransferData;
const legacyTransfer = { id: 't3' } as TransferData;

const cmaEntry = {
  id: 'c1',
  bedName: 'CMA-1',
  patientName: 'Test Patient',
  rut: '12345678-9',
  age: '45',
  diagnosis: 'Test',
  specialty: 'Cirugía',
  interventionType: 'Cirugía Mayor Ambulatoria',
} as CMAData;

// ---------------------------------------------------------------------------
// isMovementInSelectedShift
// ---------------------------------------------------------------------------
describe('isMovementInSelectedShift', () => {
  it('classifies 10:30 as day shift', () => {
    expect(isMovementInSelectedShift({ time: '10:30' }, 'day')).toBe(true);
    expect(isMovementInSelectedShift({ time: '10:30' }, 'night')).toBe(false);
  });

  it('classifies 22:00 as night shift', () => {
    expect(isMovementInSelectedShift({ time: '22:00' }, 'night')).toBe(true);
    expect(isMovementInSelectedShift({ time: '22:00' }, 'day')).toBe(false);
  });

  it('classifies 06:30 (early morning) as night shift', () => {
    expect(isMovementInSelectedShift({ time: '06:30' }, 'night')).toBe(true);
    expect(isMovementInSelectedShift({ time: '06:30' }, 'day')).toBe(false);
  });

  it('classifies 08:00 (boundary) as day shift', () => {
    expect(isMovementInSelectedShift({ time: '08:00' }, 'day')).toBe(true);
    expect(isMovementInSelectedShift({ time: '08:00' }, 'night')).toBe(false);
  });

  it('classifies 19:59 as day shift', () => {
    expect(isMovementInSelectedShift({ time: '19:59' }, 'day')).toBe(true);
  });

  it('classifies 20:00 (boundary) as night shift', () => {
    expect(isMovementInSelectedShift({ time: '20:00' }, 'night')).toBe(true);
    expect(isMovementInSelectedShift({ time: '20:00' }, 'day')).toBe(false);
  });

  it('treats missing time as day shift', () => {
    expect(isMovementInSelectedShift({}, 'day')).toBe(true);
    expect(isMovementInSelectedShift({}, 'night')).toBe(false);
  });

  it('treats undefined time as day shift', () => {
    expect(isMovementInSelectedShift({ time: undefined }, 'day')).toBe(true);
    expect(isMovementInSelectedShift({ time: undefined }, 'night')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterDischargesByShift
// ---------------------------------------------------------------------------
describe('filterDischargesByShift', () => {
  const all = [
    dayDischarge,
    nightDischarge,
    legacyDischarge,
    edgeDayEnd,
    edgeNightStart,
    earlyMorning,
  ];

  it('filters day shift discharges', () => {
    const result = filterDischargesByShift(all, 'day');
    expect(result).toContainEqual(dayDischarge);
    expect(result).toContainEqual(legacyDischarge);
    expect(result).toContainEqual(edgeDayEnd);
    expect(result).not.toContainEqual(nightDischarge);
    expect(result).not.toContainEqual(edgeNightStart);
    expect(result).not.toContainEqual(earlyMorning);
  });

  it('filters night shift discharges', () => {
    const result = filterDischargesByShift(all, 'night');
    expect(result).toContainEqual(nightDischarge);
    expect(result).toContainEqual(edgeNightStart);
    expect(result).toContainEqual(earlyMorning);
    expect(result).not.toContainEqual(dayDischarge);
    expect(result).not.toContainEqual(legacyDischarge);
  });

  it('handles undefined input', () => {
    expect(filterDischargesByShift(undefined, 'day')).toEqual([]);
    expect(filterDischargesByShift(undefined, 'night')).toEqual([]);
  });

  it('handles empty array', () => {
    expect(filterDischargesByShift([], 'day')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterTransfersByShift
// ---------------------------------------------------------------------------
describe('filterTransfersByShift', () => {
  const all = [dayTransfer, nightTransfer, legacyTransfer];

  it('filters day shift transfers', () => {
    const result = filterTransfersByShift(all, 'day');
    expect(result).toContainEqual(dayTransfer);
    expect(result).toContainEqual(legacyTransfer);
    expect(result).not.toContainEqual(nightTransfer);
  });

  it('filters night shift transfers', () => {
    const result = filterTransfersByShift(all, 'night');
    expect(result).toContainEqual(nightTransfer);
    expect(result).not.toContainEqual(dayTransfer);
    expect(result).not.toContainEqual(legacyTransfer);
  });

  it('handles undefined input', () => {
    expect(filterTransfersByShift(undefined, 'day')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterCmaByShift
// ---------------------------------------------------------------------------
describe('filterCmaByShift', () => {
  const entries = [cmaEntry];

  it('returns all CMA entries for day shift', () => {
    expect(filterCmaByShift(entries, 'day')).toEqual(entries);
  });

  it('returns empty array for night shift', () => {
    expect(filterCmaByShift(entries, 'night')).toEqual([]);
  });

  it('handles undefined input for day shift', () => {
    expect(filterCmaByShift(undefined, 'day')).toEqual([]);
  });

  it('handles undefined input for night shift', () => {
    expect(filterCmaByShift(undefined, 'night')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveMovementEmptyMessage
// ---------------------------------------------------------------------------
describe('resolveMovementEmptyMessage', () => {
  it('returns CMA night message', () => {
    expect(resolveMovementEmptyMessage('cma', 'night')).toBe('CMA solo aplica para turno de día.');
  });

  it('returns CMA day message', () => {
    expect(resolveMovementEmptyMessage('cma', 'day')).toBe('No hay pacientes de CMA hoy.');
  });

  it('returns discharge day message', () => {
    expect(resolveMovementEmptyMessage('discharges', 'day')).toBe(
      'No hay altas registradas en este turno.'
    );
  });

  it('returns discharge night message', () => {
    expect(resolveMovementEmptyMessage('discharges', 'night')).toBe(
      'No hay altas registradas durante la noche.'
    );
  });

  it('returns transfer day message', () => {
    expect(resolveMovementEmptyMessage('transfers', 'day')).toBe(
      'No hay traslados registrados en este turno.'
    );
  });

  it('returns transfer night message', () => {
    expect(resolveMovementEmptyMessage('transfers', 'night')).toBe(
      'No hay traslados registrados durante la noche.'
    );
  });
});

// ---------------------------------------------------------------------------
// resolveTransferDestinationLabel
// ---------------------------------------------------------------------------
describe('resolveTransferDestinationLabel', () => {
  it('returns receivingCenter when not "Otro"', () => {
    expect(
      resolveTransferDestinationLabel({
        receivingCenter: 'Hospital Base',
        receivingCenterOther: '',
      })
    ).toBe('Hospital Base');
  });

  it('returns receivingCenterOther when receivingCenter is "Otro"', () => {
    expect(
      resolveTransferDestinationLabel({
        receivingCenter: 'Otro',
        receivingCenterOther: 'Clinica Privada',
      })
    ).toBe('Clinica Privada');
  });

  it('returns "Otro" when receivingCenter is "Otro" and other is empty', () => {
    expect(
      resolveTransferDestinationLabel({ receivingCenter: 'Otro', receivingCenterOther: '' })
    ).toBe('Otro');
  });

  it('returns "Otro" when receivingCenter is "Otro" and other is undefined', () => {
    expect(
      resolveTransferDestinationLabel({ receivingCenter: 'Otro', receivingCenterOther: undefined })
    ).toBe('Otro');
  });
});

// ---------------------------------------------------------------------------
// resolveTransferEscortLabel
// ---------------------------------------------------------------------------
describe('resolveTransferEscortLabel', () => {
  it('returns dash for Aerocardal evacuationMethod', () => {
    expect(
      resolveTransferEscortLabel({ evacuationMethod: 'Aerocardal', transferEscort: 'Someone' })
    ).toBe('-');
  });

  it('returns transferEscort for non-Aerocardal methods', () => {
    expect(
      resolveTransferEscortLabel({ evacuationMethod: 'Ambulancia', transferEscort: 'Dr. Garcia' })
    ).toBe('Dr. Garcia');
  });

  it('returns dash when transferEscort is missing for non-Aerocardal', () => {
    expect(
      resolveTransferEscortLabel({ evacuationMethod: 'Ambulancia', transferEscort: undefined })
    ).toBe('-');
  });

  it('returns dash when transferEscort is empty string for non-Aerocardal', () => {
    expect(resolveTransferEscortLabel({ evacuationMethod: 'Ambulancia', transferEscort: '' })).toBe(
      '-'
    );
  });
});
