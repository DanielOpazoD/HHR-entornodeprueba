import { afterEach, describe, expect, it } from 'vitest';

import '../../../extension/fichamedico-isolation-normalization.js';
import '../../../extension/fichamedico-treating-physician-sources.js';
import '../../../extension/fichamedico-treating-physician-normalization.js';
import '../../../extension/fichamedico-normalization.js';

const treatingPhysicianNormalization = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoTreatingPhysicianNormalization: {
      assignedFromDocument: (root: Document) => Array<{
        practitionerId: string;
        displayName: string;
      }>;
      captureFromDocument: (options: Record<string, unknown>) => Promise<unknown>;
      merge: (...sources: unknown[]) => Array<{
        practitionerId: string;
        displayName: string;
      }>;
      normalize: (rows: unknown) => Array<{
        practitionerId: string;
        displayName: string;
      }>;
    };
  }
).HhrFichaMedicoTreatingPhysicianNormalization;

const normalization = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoNormalization: {
      normalizeEncounter: (
        item: unknown,
        header: unknown,
        principalDiagnosis: unknown,
        discharged?: boolean,
        physicianById?: Record<string, unknown>
      ) => Record<string, unknown>;
      normalizeSessionExpiry: (session: unknown, payload?: unknown) => number | null;
      normalizeSessionRole: (session: unknown) => string;
      selectPrincipalDiagnosis: (
        rows: unknown[],
        header?: Record<string, unknown>,
        listItem?: Record<string, unknown>
      ) => { name: string; code: string; source: string };
      validClinicalDate: (value: unknown) => string | undefined;
      requiresIsolationDetails: (value: unknown) => boolean;
    };
  }
).HhrFichaMedicoNormalization;

afterEach(() => {
  document.body.innerHTML = '';
});

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
  it('normalizes the facility physician catalog and resolves the encounter assignment by id', () => {
    const physicians = treatingPhysicianNormalization.normalize([
      { id: 7947, firstGivenName: 'Angelica', firstFamilyName: 'Vargas' },
      { id: 7947, firstGivenName: 'Duplicada', firstFamilyName: 'No usar' },
      { id: null, firstGivenName: 'Sin', firstFamilyName: 'Id' },
    ]);
    const physicianById = Object.fromEntries(
      physicians.map(physician => [physician.practitionerId, physician])
    );

    expect(physicians).toEqual([{ practitionerId: '7947', displayName: 'Angelica Vargas' }]);
    expect(
      normalization.normalizeEncounter(
        { id: 141336, healthCarePractitionerAssignedId: 7947 },
        {},
        {},
        false,
        physicianById
      )
    ).toMatchObject({
      treatingPhysicianId: '7947',
      treatingPhysicianName: 'Angelica Vargas',
    });
  });

  it('accepts wrapped or nested physician catalogs from compatible Ficha Medico versions', () => {
    expect(
      treatingPhysicianNormalization.normalize({
        data: [
          {
            id: 512,
            healthCarePractitioner: {
              id: 7947,
              fullName: '  Angelica   Vargas ',
            },
          },
        ],
      })
    ).toEqual([{ practitionerId: '7947', displayName: 'Angelica Vargas' }]);
  });

  it('recovers assigned physician identities from the rendered census rows', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Servicio</th><th>Asignación</th></tr></thead>
        <tbody><tr>
          <td><div role="combobox">Medicina</div><input value="404" /></td>
          <td><div role="combobox"> Angelica   Vargas </div><input value="7947" /></td>
        </tr><tr>
          <td><div role="combobox">Cirugía</div><input value="405" /></td>
          <td><div role="combobox">Sin asignación</div><input value="0" /></td>
        </tr></tbody>
      </table>
    `;

    expect(treatingPhysicianNormalization.assignedFromDocument(document)).toEqual([
      { practitionerId: '7947', displayName: 'Angelica Vargas' },
    ]);
  });

  it('exposes malformed rendered assignments as a rejected capture promise', async () => {
    const malformedRoot = {
      querySelectorAll: () => {
        throw new Error('malformed physician assignment table');
      },
    } as unknown as Document;

    await expect(
      treatingPhysicianNormalization.captureFromDocument({
        apiGet: async () => [],
        apiOrigin: 'https://fichamedico.example',
        facilityId: '1',
        auth: {},
        root: malformedRoot,
      })
    ).rejects.toThrow('malformed physician assignment table');
  });

  it('keeps current assigned-row evidence ahead of a stale facility catalog name', () => {
    expect(
      treatingPhysicianNormalization.merge(
        [{ practitionerId: '7947', displayName: 'Angelica Vargas' }],
        [
          { id: 7947, displayName: 'Nombre anterior' },
          { id: 7942, displayName: 'Otra médica' },
        ]
      )
    ).toEqual([
      { practitionerId: '7947', displayName: 'Angelica Vargas' },
      { practitionerId: '7942', displayName: 'Otra médica' },
    ]);
  });

  it('requests separate detail only for active isolation signals', () => {
    expect(normalization.requiresIsolationDetails({ isIsolated: true })).toBe(true);
    expect(normalization.requiresIsolationDetails({ isIsolated: false })).toBe(false);
    expect(
      normalization.requiresIsolationDetails({
        isIsolated: true,
        isolationEntries: [{ isoTypeName: 'Gotas', endIsolationDatetime: '2026-07-24' }],
      })
    ).toBe(false);
  });

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
