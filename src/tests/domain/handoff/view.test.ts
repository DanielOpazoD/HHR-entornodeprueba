import { describe, expect, it } from 'vitest';
import type { BedDefinition } from '@/types/domain/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty } from '@/types/domain/patientClassification';
import {
  buildMedicalHandoffDeepLink,
  buildMedicalSpecialtyLink,
  collectMedicalSpecialties,
  filterBedsByMedicalScope,
  filterBedsBySelectedMedicalSpecialty,
  hasVisibleMedicalPatients,
  resolveInitialMedicalScopeFromSearch,
  resolveInitialMedicalSpecialtyFromSearch,
} from '@/domain/handoff/view';

const BEDS: BedDefinition[] = [
  { id: 'R1', name: 'R1', type: 'MEDIA', isCuna: false },
  { id: 'H1C1', name: 'H1C1', type: 'MEDIA', isCuna: false },
] as BedDefinition[];

const RECORD = {
  date: '2026-03-03',
  beds: {
    R1: {
      patientName: 'Paciente UPC',
      specialty: Specialty.MEDICINA,
      isUPC: true,
      upcChecklist: {
        uciCriteria: ['uci_vmi'],
        utiCriteria: [],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-04-18T10:00:00Z',
      },
    },
    H1C1: {
      patientName: 'Paciente Sala',
      specialty: Specialty.CIRUGIA,
      isUPC: true,
    },
  },
} as unknown as DailyRecord;

describe('handoff view domain', () => {
  it('resolves initial scope and specialty from search params', () => {
    expect(resolveInitialMedicalSpecialtyFromSearch('?specialty=Cirug%C3%ADa')).toBe(
      Specialty.CIRUGIA
    );
    expect(resolveInitialMedicalSpecialtyFromSearch('?module=MEDICAL_HANDOFF')).toBe('all');
    expect(resolveInitialMedicalScopeFromSearch('?scope=upc')).toBe('upc');
    expect(resolveInitialMedicalScopeFromSearch('?scope=no-upc')).toBe('no-upc');
    expect(resolveInitialMedicalScopeFromSearch('?module=MEDICAL_HANDOFF')).toBe('all');
  });

  it('filters beds, collects specialties and builds deep links', () => {
    expect(filterBedsByMedicalScope(BEDS, RECORD, true, 'upc').map(bed => bed.id)).toEqual(['R1']);
    expect(filterBedsByMedicalScope(BEDS, RECORD, true, 'no-upc').map(bed => bed.id)).toEqual([
      'H1C1',
    ]);
    expect(
      filterBedsBySelectedMedicalSpecialty(BEDS, RECORD, true, Specialty.CIRUGIA).map(bed => bed.id)
    ).toEqual(['H1C1']);
    expect(collectMedicalSpecialties(BEDS, RECORD, true)).toEqual([
      Specialty.MEDICINA,
      Specialty.CIRUGIA,
    ]);
    expect(hasVisibleMedicalPatients(BEDS, RECORD, bedId => bedId === 'H1C1')).toBe(true);
    expect(
      buildMedicalSpecialtyLink(
        'https://app.hospitalhangaroa.cl',
        '/handoff',
        '2026-03-03',
        Specialty.CIRUGIA
      )
    ).toBe(
      'https://app.hospitalhangaroa.cl/handoff?module=MEDICAL_HANDOFF&date=2026-03-03&specialty=Cirug%C3%ADa'
    );
    expect(
      buildMedicalHandoffDeepLink(
        'https://app.hospitalhangaroa.cl',
        '/handoff',
        '2026-03-03',
        'upc',
        Specialty.CIRUGIA
      )
    ).toBe(
      'https://app.hospitalhangaroa.cl/handoff?module=MEDICAL_HANDOFF&date=2026-03-03&scope=upc&specialty=Cirug%C3%ADa'
    );
  });

  it('treats checklist-backed UPC beds as UPC even when the legacy boolean is stale', () => {
    const staleRecord = {
      ...RECORD,
      beds: {
        ...RECORD.beds,
        R1: {
          ...RECORD.beds.R1,
          isUPC: false,
        },
      },
    } as unknown as DailyRecord;

    expect(filterBedsByMedicalScope(BEDS, staleRecord, true, 'upc').map(bed => bed.id)).toEqual([
      'R1',
    ]);
    expect(filterBedsByMedicalScope(BEDS, staleRecord, true, 'no-upc').map(bed => bed.id)).toEqual([
      'H1C1',
    ]);
  });
});

// Preserve the legacy boolean-only fixture separately from checklist-backed UPC cases.
describe('handoff view with legacy boolean UPC classification', () => {
  const BEDS: BedDefinition[] = [
    { id: 'R1', name: '101', type: 'MEDIA', isCuna: false },
    { id: 'R2', name: '102', type: 'MEDIA', isCuna: false },
  ] as BedDefinition[];

  const RECORD = {
    date: '2026-03-03',
    beds: {
      R1: {
        patientName: 'Paciente UPC',
        specialty: Specialty.MEDICINA,
        isUPC: true,
      },
      R2: {
        patientName: 'Paciente Sala',
        specialty: Specialty.CIRUGIA,
        isUPC: false,
      },
    },
  } as unknown as DailyRecord;

  it('filters beds by medical scope and selected specialty', () => {
    const upcBeds = filterBedsByMedicalScope(BEDS, RECORD, true, 'upc');
    const noUpcBeds = filterBedsByMedicalScope(BEDS, RECORD, true, 'no-upc');
    const surgeryBeds = filterBedsBySelectedMedicalSpecialty(BEDS, RECORD, true, Specialty.CIRUGIA);

    expect(upcBeds.map(bed => bed.id)).toEqual(['R1']);
    expect(noUpcBeds.map(bed => bed.id)).toEqual(['R2']);
    expect(surgeryBeds.map(bed => bed.id)).toEqual(['R2']);
  });

  it('collects specialties, detects visible patients, and builds deep links', () => {
    expect(collectMedicalSpecialties(BEDS, RECORD, true)).toEqual([
      Specialty.MEDICINA,
      Specialty.CIRUGIA,
    ]);
    expect(hasVisibleMedicalPatients(BEDS, RECORD, bedId => bedId === 'R2')).toBe(true);
    expect(
      buildMedicalSpecialtyLink(
        'https://app.hospitalhangaroa.cl',
        '/handoff',
        '2026-03-03',
        Specialty.CIRUGIA
      )
    ).toBe(
      'https://app.hospitalhangaroa.cl/handoff?module=MEDICAL_HANDOFF&date=2026-03-03&specialty=Cirug%C3%ADa'
    );
    expect(
      buildMedicalHandoffDeepLink(
        'https://app.hospitalhangaroa.cl',
        '/handoff',
        '2026-03-03',
        'upc',
        Specialty.CIRUGIA
      )
    ).toBe(
      'https://app.hospitalhangaroa.cl/handoff?module=MEDICAL_HANDOFF&date=2026-03-03&scope=upc&specialty=Cirug%C3%ADa'
    );
  });
});
