import { describe, expect, it } from 'vitest';

import '../../../extension/fichamedico-isolation-normalization.js';
import '../../../extension/fichamedico-normalization.js';

const normalization = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoNormalization: {
      normalizeEncounter: (
        item: unknown,
        header: unknown,
        principalDiagnosis: unknown,
        discharged?: boolean
      ) => Record<string, unknown>;
      normalizeSessionExpiry: (session: unknown, payload?: unknown) => number | null;
      normalizeSessionRole: (session: unknown) => string;
      selectPrincipalDiagnosis: (
        rows: unknown[],
        header?: Record<string, unknown>,
        listItem?: Record<string, unknown>
      ) => { name: string; code: string; source: string };
      validClinicalDate: (value: unknown) => string | undefined;
    };
  }
).HhrFichaMedicoNormalization;

describe('Ficha Medico identity and session normalization', () => {
  it.each([
    [{ role: '  Médico   cirujano  ' }, 'Médico cirujano'],
    [{ role: '', healthCarePractitionerRoleName: ' Enfermera(o) ' }, 'Enfermera(o)'],
    [{ profileName: 'Enfermería' }, 'Enfermería'],
    [null, ''],
  ])('normalizes role fixture %#', (session, expected) => {
    expect(normalization.normalizeSessionRole(session)).toBe(expected);
  });

  it.each([
    [{ expiresAt: 1_800_000_000 }, undefined, 1_800_000_000_000],
    [{ expires: 1_800_000_000_123 }, undefined, 1_800_000_000_123],
    [{ expirationDateTime: '2027-01-15T12:30:00.000Z' }, undefined, 1_800_016_200_000],
    [{}, { expires: 'not-a-date' }, null],
    [null, null, null],
  ])('normalizes expiration fixture %#', (session, payload, expected) => {
    expect(normalization.normalizeSessionExpiry(session, payload)).toBe(expected);
  });
});

describe('Ficha Medico census normalization', () => {
  it.each([
    ['0001-01-01T00:00:00.000Z', undefined],
    ['2026-07-18T14:30:00.000Z', '2026-07-18T14:30:00.000Z'],
    ['not-a-date', undefined],
    [null, undefined],
  ])('normalizes clinical date fixture %#', (value, expected) => {
    expect(normalization.validClinicalDate(value)).toBe(expected);
  });

  it('preserves the Ficha Medico encounter snapshot shape', () => {
    expect(
      normalization.normalizeEncounter(
        {
          id: 141336,
          patient: { identifier: '12.345.678-5', patientName: 'Ana   María' },
          hospitalDepartmentShortName: 'MED',
          roomShortName: 'Sala 1',
          bedShortName: 'Cama 2',
          hasNurseDischarge: true,
          isIsolated: true,
          isoTypeName: 'Gotas',
          microName: 'Virus Influenza B',
        },
        {
          firstGivenName: 'Ana',
          firstFamilyName: 'Pérez',
          encEndPeriod: '0001-01-01T00:00:00.000Z',
        },
        { name: 'Neumonía', code: 'J18.9' },
        false
      )
    ).toMatchObject({
      encounterId: '141336',
      run: '12.345.678-5',
      firstGivenName: 'Ana',
      firstFamilyName: 'Pérez',
      service: 'MED',
      room: 'Sala 1',
      bed: 'Cama 2',
      diagnosis: 'Neumonía',
      diagnosisCode: 'J18.9',
      diagnosisDescription: 'Neumonía',
      hasNurseDischarge: true,
      isIsolated: true,
      isolationType: 'Gotas',
      isolationMicroorganism: 'Virus Influenza B',
      dischargeDatetime: undefined,
    });
  });

  it('does not reactivate an explicitly inactive or historically ended isolation', () => {
    const explicitlyInactive = normalization.normalizeEncounter(
      { id: 1, isIsolated: false, isoTypeName: 'Gotas' },
      {},
      {},
      false
    );
    const historicalOnly = normalization.normalizeEncounter(
      {
        id: 2,
        isIsolated: true,
        isolations: [
          {
            isoTypeName: 'Contacto',
            endIsolationDatetime: '2026-07-24T18:00:00.000Z',
          },
        ],
      },
      {},
      {},
      false
    );

    expect(explicitlyInactive).toMatchObject({ isIsolated: false });
    expect(explicitlyInactive).not.toHaveProperty('isolationType');
    expect(historicalOnly).toMatchObject({ isIsolated: false });
    expect(historicalOnly).not.toHaveProperty('isolationType');
  });

  it.each([
    [undefined, undefined, undefined],
    [{ id: null, patient: null }, null, null],
    [{ id: 44 }, { encEndPeriod: 'invalid' }, { name: 'Sin código' }],
  ])('fails closed for incomplete encounter fixture %#', (item, header, diagnosis) => {
    expect(() => normalization.normalizeEncounter(item, header, diagnosis)).not.toThrow();
    expect(normalization.normalizeEncounter(item, header, diagnosis)).toMatchObject({
      encounterId: item && item.id != null ? String(item.id) : '',
      run: '',
      diagnosis: diagnosis?.name || '',
      diagnosisCode: undefined,
      diagnosisDescription: undefined,
      dischargeDatetime: undefined,
      hasMedicalDischarge: false,
      hasNurseDischarge: false,
    });
  });
});

describe('Ficha Medico diagnosis normalization', () => {
  it('selects the first active principal diagnosis and its CIE-10 code', () => {
    expect(
      normalization.selectPrincipalDiagnosis(
        [
          {
            diagnosisName: 'Diagnóstico archivado',
            internalCode: 'A00.0',
            isPrincipal: true,
            archived: true,
          },
          {
            diagnosisName: 'Neumonía bacteriana',
            internalCode: 'J15.9',
            isPrincipal: 'S',
            archived: 'N',
            deleted: 0,
          },
          {
            diagnosisName: 'Diagnóstico secundario',
            internalCode: 'R50.9',
            isPrincipal: false,
          },
        ],
        { principalDiagName: 'Fallback' }
      )
    ).toEqual({
      name: 'Neumonía bacteriana',
      code: 'J15.9',
      source: 'principal-entry',
    });
  });

  it('falls back to the principal header diagnosis when entries are unavailable', () => {
    expect(
      normalization.selectPrincipalDiagnosis([], { principalDiagName: 'Diagnóstico principal' })
    ).toEqual({ name: 'Diagnóstico principal', code: '', source: 'principal-header' });
  });
});
