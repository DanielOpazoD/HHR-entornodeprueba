import { describe, expect, it } from 'vitest';
import {
  buildAdmissionAuditEntry,
  collectAdmissionCandidates,
  groupAdmissionAuthors,
  withinAdmissionHistory,
  type AdmissionCandidate,
} from '@/features/admin/admission-audit/admissionAuditModel';
import {
  admissionVitalRows,
  buildAdmissionAuditBook,
} from '@/features/admin/admission-audit/admissionAuditBook';
import { panelResult } from '../../../views/census/clinicalPanelDrawer.fixture';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const patient: AdmissionCandidate = {
  key: 'person:101',
  episodeId: '101',
  patientName: 'Paciente Sintético',
  document: '12.345.678-5',
  admissionDate: '2026-07-13',
  admissionTime: '08:00',
};
const note = (
  id: number,
  at: string,
  role = 'Médico',
  author = 'Ana',
  text = 'Ingreso sintético'
) => ({
  id,
  OBE_PUBLISH_DATETIME: at,
  HCPR_NAME: role,
  HCP_FGN: author,
  HCP_FFN: 'Prueba',
  OBE_NOTES: text,
});
const event = (notes: unknown[]) => ({ ...panelResult.events[0], evolutionResume: notes });
const vital = (at: string, heartRate: number): PatientVitalSigns => ({
  recordedDate: '2026-07-13',
  recordedAt: at,
  heartRate,
  systolic: null,
  diastolic: null,
  spo2: null,
  temperature: null,
  respiratoryRate: null,
  painEva: 0,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: 'Enfermería Sintética',
  authorRole: 'Enfermera',
});

describe('admission audit projection', () => {
  it('discovers a discharged episode from historical identity and admission metadata without a live bed', () => {
    const originalData = DataFactory.createMockPatient('R1', {
      patientName: patient.patientName,
      rut: patient.document,
      clinicalEpisodeId: patient.episodeId,
      admissionDate: patient.admissionDate,
      admissionTime: patient.admissionTime,
    });
    const discharge = DataFactory.createMockDischarge({
      patientName: patient.patientName,
      rut: patient.document,
      clinicalEpisodeId: undefined,
      admissionDate: undefined,
      originalData,
    });
    const rows = collectAdmissionCandidates(
      [DataFactory.createMockDailyRecord('2026-07-13', { beds: {}, discharges: [discharge] })],
      { from: '2026-07-13', to: '2026-07-13' }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      episodeId: patient.episodeId,
      document: patient.document,
      admissionDate: patient.admissionDate,
      admissionTime: patient.admissionTime,
    });
  });
  it.each(['sin fecha', '13-07-2026'])(
    'does not select a later measurement over an incomplete take: %s',
    stamp => {
      const result = buildAdmissionAuditEntry(
        patient,
        [event([note(1, '2026-07-13T08:10')])],
        [vital(stamp, 70), vital('13-07-2026 08:02', 82)],
        'first-set'
      );
      expect(result.vital).toBeNull();
      expect(result.issues.join(' ')).toContain('tomas de signos vitales sin fecha verificable');
    }
  );
  it('refuses a standalone book containing only failed or stale clinical reads', () => {
    const entry = {
      ...buildAdmissionAuditEntry(patient, [event([note(1, '2026-07-13T08:10')])], [], 'first-set'),
      readError: 'Fallo sintético',
    };
    expect(() =>
      buildAdmissionAuditBook(
        {
          entries: [entry],
          period: { from: '2026-07-13', to: '2026-07-13' },
          indicationScope: 'first-set',
        },
        null
      )
    ).toThrow('No hay lecturas clínicas actualizadas');
  });
  it.each([
    [
      'patientPharmaIndicationResume',
      { DESCRIPTOR: 'Fármaco', POSOLOGY: 'Original' },
      { DESCRIPTOR: 'Fármaco', POSOLOGY: 'Cambio' },
    ],
    ['patientFreeIndicationResume', { INDICATION: 'Original' }, { INDICATION: 'Cambio' }],
    ['nutritionOrderResume', { DIET_type: 'Original' }, { DIET_type: 'Cambio' }],
    ['restResume', { rest_type: 'Original' }, { rest_type: 'Cambio' }],
  ] as const)(
    'fails closed for anonymous conflicting %s snapshots regardless of observation order',
    (field, firstRow, nextRow) => {
      const base = {
        ...event([note(1, '2026-07-13T08:10')]),
        patientPharmaIndicationResume: [],
        patientFreeIndicationResume: [],
        nutritionOrderResume: [],
        restResume: [],
      };
      for (const observed of ['2026-07-13T09:00', '2026-07-13T10:00']) {
        const first = {
          ...base,
          publishDatetime: '2026-07-13T09:00',
          [field]: [{ ...firstRow, PUBLISH_DATETIME: '2026-07-13T08:30' }],
        };
        const next = {
          ...base,
          publishDatetime: observed,
          [field]: [{ ...nextRow, PUBLISH_DATETIME: '2026-07-13T08:30' }],
        };
        const result = buildAdmissionAuditEntry(patient, [next, first], [], 'first-set');
        expect(result.notes).toHaveLength(1);
        expect(result.indications).toEqual([]);
        expect(result.issues.join(' ')).toContain('versiones discrepantes');
      }
    }
  );
  it('rejects conflicting initial-order revisions tied on publication and source observation', () => {
    const raw = {
      ...event([note(1, '2026-07-13T08:10')]),
      patientPharmaIndicationResume: [
        {
          MRE_ID: 7,
          DESCRIPTOR: 'Tratamiento',
          POSOLOGY: 'Texto A',
          PUBLISH_DATETIME: '2026-07-13T08:00',
        },
        {
          MRE_ID: 7,
          DESCRIPTOR: 'Tratamiento',
          POSOLOGY: 'Texto B',
          PUBLISH_DATETIME: '2026-07-13T08:00',
        },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    };
    const result = buildAdmissionAuditEntry(patient, [raw], [], 'first-set');
    expect(result.notes).toHaveLength(1);
    expect(result.indications).toEqual([]);
    expect(result.issues.join(' ')).toContain('versiones discrepantes');
  });
  it('orders tied publications by earliest source observation, independently of backend array order', () => {
    const first = {
      ...event([note(1, '2026-07-13T08:10')]),
      publishDatetime: '2026-07-13T09:00',
      patientPharmaIndicationResume: [
        {
          MRE_ID: 7,
          DESCRIPTOR: 'Tratamiento',
          POSOLOGY: 'Original',
          PUBLISH_DATETIME: '2026-07-13T08:00',
        },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    };
    const later = {
      ...first,
      publishDatetime: '2026-07-13T10:00',
      patientPharmaIndicationResume: [
        { ...first.patientPharmaIndicationResume[0], POSOLOGY: 'Revisión' },
      ],
    };
    expect(
      buildAdmissionAuditEntry(patient, [later, first], [], 'first-set').indications.map(
        n => n.text
      )
    ).toEqual(['Original']);
  });
  it('does not block medical admission evidence because unrelated nursing versions conflict', () => {
    const raw = event([
      note(1, '2026-07-13T08:10'),
      note(9, '2026-07-13T08:00', 'Enfermera', 'Enfermería', 'Texto A'),
      note(9, '2026-07-13T08:00', 'Enfermera', 'Enfermería', 'Texto B'),
    ]);
    expect(buildAdmissionAuditEntry(patient, [raw], [], 'first-set').notes.map(n => n.id)).toEqual([
      '1',
    ]);
  });
  it('bounds the period before census reads using the same supported lookback', () => {
    const now = Date.parse('2026-11-07T06:00:00Z');
    expect(withinAdmissionHistory('1980-01-01', now)).toBe(false);
    expect(withinAdmissionHistory('2026-07-13', now)).toBe(true);
    expect(withinAdmissionHistory('2026-02-31', now)).toBe(false);
  });
  it('does not invent stable identities for anonymous diet/rest revisions across admission', () => {
    const raw = {
      ...event([note(1, '2026-07-13T08:10')]),
      nutritionOrderResume: [
        { DIET_type: 'Régimen previo', PUBLISH_DATETIME: '2026-07-13T07:00' },
        { DIET_type: 'Régimen modificado', PUBLISH_DATETIME: '2026-07-13T08:30' },
      ],
      restResume: [],
      patientFreeIndicationResume: [],
      patientPharmaIndicationResume: [
        { MRE_ID: 2, DESCRIPTOR: 'Orden de ingreso', PUBLISH_DATETIME: '2026-07-13T08:30' },
      ],
    };
    const result = buildAdmissionAuditEntry(patient, [raw], [], 'first-set');
    expect(result.indications.map(n => n.title)).toEqual(['Orden de ingreso']);
    expect(result.issues.join(' ')).toContain('sin identificador estable');
  });
  it('shows missing measurements explicitly and preserves a measured zero', () => {
    const rows = admissionVitalRows(vital('13-07-2026 08:02', 82));
    expect(rows).toContainEqual(['PA', '—']);
    expect(rows).toContainEqual(['Temperatura', '—']);
    expect(rows).toContainEqual(['EVA', '0']);
    expect(rows).toContainEqual(['FC', '82 lpm']);
  });
  it('does not reclassify a pre-admission order revision as an initial order, even within one event', () => {
    const raw = {
      ...event([note(1, '2026-07-13T08:10')]),
      patientPharmaIndicationResume: [
        {
          MRE_ID: 1,
          DESCRIPTOR: 'Orden previa',
          POSOLOGY: 'Original',
          PUBLISH_DATETIME: '2026-07-13T07:00',
        },
        {
          MRE_ID: 1,
          DESCRIPTOR: 'Orden previa',
          POSOLOGY: 'Revisión',
          PUBLISH_DATETIME: '2026-07-13T08:15',
        },
        { MRE_ID: 2, DESCRIPTOR: 'Orden de ingreso', PUBLISH_DATETIME: '2026-07-13T08:30' },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    };
    const result = buildAdmissionAuditEntry(patient, [raw], [], 'first-set');
    expect(result.indications.map(n => n.title)).toEqual(['Orden de ingreso']);
  });
  it('uses the current observed version of an amended source note instead of displaying both texts', () => {
    const original = {
      ...event([note(1, '2026-07-13T08:10', 'Médico', 'Ana', 'Texto original')]),
      publishDatetime: '2026-07-13T09:00',
    };
    const revised = {
      ...event([
        { ...note(1, '2026-07-13T08:10', 'Médico', 'Ana', 'Texto enmendado'), OBE_AMENDED: true },
      ]),
      publishDatetime: '2026-07-13T10:00',
    };
    const result = buildAdmissionAuditEntry(patient, [revised, original], [], 'first-set');
    expect(result.notes.map(n => n.text)).toEqual(['Texto enmendado']);
  });
  it('applies the latest note annulment before selecting the first valid evolution', () => {
    const original = {
      ...event([note(1, '2026-07-13T08:10')]),
      publishDatetime: '2026-07-13T09:00',
    };
    const latest = {
      ...event([
        { ...note(1, '2026-07-13T08:10'), IS_CROSSED_OUT: true },
        note(2, '2026-07-13T10:00'),
      ]),
      publishDatetime: '2026-07-13T10:30',
    };
    expect(
      buildAdmissionAuditEntry(patient, [original, latest], [], 'first-set').notes.map(n => n.id)
    ).toEqual(['2']);
  });
  it('refuses conflicting revisions with no verifiable observation order', () => {
    expect(() =>
      buildAdmissionAuditEntry(
        patient,
        [
          event([note(1, '2026-07-13T08:10', 'Médico', 'Ana', 'Texto A')]),
          event([note(1, '2026-07-13T08:10', 'Médico', 'Ana', 'Texto B')]),
        ],
        [],
        'first-set'
      )
    ).toThrow('orden de revisión verificable');
  });
  it('includes initial orders across midnight after a 23:59 admission and excludes later sets', () => {
    const overnight = { ...patient, admissionTime: '23:59' };
    const initial = {
      ...event([note(1, '2026-07-14T00:20')]),
      publishDatetime: '2026-07-14T00:30',
      patientPharmaIndicationResume: [
        { MRE_ID: 1, DESCRIPTOR: 'Orden inicial A', PUBLISH_DATETIME: '2026-07-14T00:30' },
        { MRE_ID: 2, DESCRIPTOR: 'Orden inicial B', PUBLISH_DATETIME: '2026-07-14T00:30' },
        { MRE_ID: 3, DESCRIPTOR: 'Orden de la mañana', PUBLISH_DATETIME: '2026-07-14T08:00' },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    };
    const result = buildAdmissionAuditEntry(overnight, [initial], [], 'first-set');
    expect(result.indications.map(n => n.title)).toEqual(['Orden inicial A', 'Orden inicial B']);
    expect(result.notes[0].publishedAt).toBe('2026-07-14T00:20');
  });
  it('selects the first valid medical evolution after admission, not nursing, shift handoff or latest note', () => {
    const archived = { ...note(9, '2026-07-13T08:01'), ARCHIVED: true };
    const result = buildAdmissionAuditEntry(
      patient,
      [
        event([
          note(4, '2026-07-13T11:00'),
          note(2, '2026-07-13T08:05', 'Enfermera'),
          note(1, '2026-07-13T07:00'),
          archived,
          note(3, '2026-07-13T08:10'),
        ]),
      ],
      [vital('13-07-2026 12:00', 90), vital('13-07-2026 08:02', 80), vital('13-07-2026 07:00', 70)],
      'first-day'
    );
    expect(result.notes.map(n => n.id)).toEqual(['3']);
    expect(result.doctor).toBe('Ana Prueba');
    expect(result.vital?.heartRate).toBe(80);
    expect(result.vital?.painEva).toBe(0);
  });
  it('orders absolute and hospital wall clocks consistently with seconds', () => {
    const result = buildAdmissionAuditEntry(
      patient,
      [event([note(1, '2026-07-13T14:10:59Z'), note(2, '2026-07-13T08:10:01')])],
      [],
      'first-day'
    );
    expect(result.notes[0].id).toBe('2');
  });
  it('does not attribute simultaneous first notes by different doctors to an arbitrary author', () => {
    const result = buildAdmissionAuditEntry(
      patient,
      [
        event([
          note(1, '2026-07-13T08:10', 'Médico', 'Ana'),
          note(2, '2026-07-13T08:10', 'Médico', 'Luis'),
        ]),
      ],
      [],
      'first-day'
    );
    expect(result.doctor).toBe('Sin atribuir');
    expect(result.notes).toHaveLength(2);
    expect(groupAdmissionAuthors([result])[0].count).toBe(1);
  });
  it('retains first-day source orders and their earliest posology even when now inactive', () => {
    const old = event([note(1, '2026-07-13T08:10')]);
    const later = {
      ...old,
      patientPharmaIndicationResume: [
        {
          ...old.patientPharmaIndicationResume[0],
          POSOLOGY: 'Cambio posterior',
          PUBLISH_DATETIME: '2026-07-13T15:00',
        },
      ],
    };
    const result = buildAdmissionAuditEntry(patient, [later, old], [], 'first-day');
    expect(result.indications.find(n => n.id === '7')?.text).toContain('2 g cada 24 h');
    const first = buildAdmissionAuditEntry(patient, [old], [], 'first-set');
    expect(first.indications.map(n => n.id)).toEqual(['7']);
  });
  it('refuses to name a first note if an undated medical evolution cannot be ordered', () => {
    expect(() =>
      buildAdmissionAuditEntry(
        patient,
        [{ ...event([note(1, '')]), publishDatetime: '' }],
        [],
        'first-day'
      )
    ).toThrow('sin fecha verificable');
  });
  it('reports undated source orders instead of mislabelling a later dated order as initial', () => {
    const raw = event([note(1, '2026-07-13T08:10')]);
    const undated = {
      ...raw,
      publishDatetime: '',
      evolutionResume: [],
      patientPharmaIndicationResume: [
        { MRE_ID: 90, DESCRIPTOR: 'Orden sin fecha', PUBLISH_DATETIME: '' },
      ],
    };
    const result = buildAdmissionAuditEntry(patient, [raw, undated], [], 'first-day');
    expect(result.notes).toHaveLength(1);
    expect(result.indications).toHaveLength(0);
    expect(result.issues.join(' ')).toContain('indicaciones sin fecha verificable');
  });
  it('shows the actual next-day vital measurement with a warning rather than inventing admission vitals', () => {
    const nextDay = { ...vital('14-07-2026 00:02', 82), recordedDate: '2026-07-14' };
    const result = buildAdmissionAuditEntry(
      patient,
      [event([note(1, '2026-07-13T08:10')])],
      [nextDay],
      'first-day'
    );
    expect(result.vital).toEqual(nextDay);
    expect(result.issues.join(' ')).toContain('toma disponible es posterior');
  });
  it('deduplicates beds and transfers by normalized identity and episode and keeps readmission separate', () => {
    const p = DataFactory.createMockPatient('R1', {
      patientName: patient.patientName,
      rut: '12.345.678-5',
      clinicalEpisodeId: '101',
      admissionDate: patient.admissionDate,
      admissionTime: '08:00',
    });
    const record = DataFactory.createMockDailyRecord('2026-07-13');
    record.beds.R1 = p;
    record.beds.R2 = { ...p, rut: '12345678-5' };
    const next = structuredClone(record);
    next.date = '2026-07-14';
    next.beds.R1 = { ...p, clinicalEpisodeId: '102', admissionDate: '2026-07-14' };
    const rows = collectAdmissionCandidates([record, next], {
      from: '2026-07-13',
      to: '2026-07-14',
    });
    expect(rows.map(r => r.episodeId)).toEqual(['101', '102']);
  });
  it('exports only the selected author in an escaped indexed HTML book with no remote assets', () => {
    const a = buildAdmissionAuditEntry(
      patient,
      [event([note(1, '2026-07-13T08:10', 'Médico', 'Ana', '<script>alert(1)</script>')])],
      [],
      'first-day'
    );
    const b = buildAdmissionAuditEntry(
      { ...patient, key: 'other', patientName: 'Otro Paciente' },
      [event([note(2, '2026-07-13T08:20', 'Médico', 'Luis')])],
      [],
      'first-day'
    );
    b.readError = 'Fallo sintético ajeno al autor exportado';
    const html = buildAdmissionAuditBook(
      {
        entries: [a, b],
        period: { from: '2026-07-13', to: '2026-07-13' },
        indicationScope: 'first-day',
      },
      'Ana Prueba'
    );
    expect(html).toContain('href="#ingreso-0"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Otro Paciente');
    expect(html).toContain('0 episodio(s) del libro sin lectura');
    expect(html).toContain('Ana Prueba · 1/1 ingresos verificados');
    expect(html).toContain('2 g cada 24 h');
    expect(html).not.toContain('actualmente marcado');
    expect(html).toContain('guardar como PDF');
    expect(html).toContain("default-src 'none'");
  });
});
