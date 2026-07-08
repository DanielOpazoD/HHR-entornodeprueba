/**
 * Tests for the IEEH print controller (epicrisis → IEEH PDF data mapping).
 */

import { describe, expect, it } from 'vitest';
import {
  buildIeehPatientFromEpicrisis,
  buildIeehDischargeFromEpicrisis,
  parseDoctorName,
} from '@/features/clinical-documents/controllers/clinicalDocumentIeehPrintController';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentIeehDraft } from '@/features/clinical-documents/domain/entities';

/** Builds a minimal typed IEEH draft for tests. */
const buildDraft = (
  overrides: Partial<ClinicalDocumentIeehDraft> = {}
): ClinicalDocumentIeehDraft => ({
  cie10Code: 'A00',
  cie10Description: 'test',
  diagnosticoPrincipal: 'test',
  condicionEgreso: '1',
  intervencionQuirurgica: '2',
  procedimiento: '2',
  ...overrides,
});

const baseDoc = createClinicalDocumentDraft({
  templateId: 'epicrisis',
  hospitalId: 'hhr',
  actor: { uid: 'u1', email: 'dr@hhr.cl', displayName: 'Dr. Test', role: 'admin' },
  episode: {
    patientRut: '11.111.111-1',
    patientName: 'Juan Pérez López',
    episodeKey: '11.111.111-1__2026-04-01',
    admissionDate: '2026-04-01',
    sourceDailyRecordDate: '2026-04-10',
    sourceBedId: 'R1',
    specialty: 'Medicina',
  },
  patientFieldValues: {},
  medico: 'Opazo Damiani Daniel',
  especialidad: 'Medicina',
});

// ---------------------------------------------------------------------------
// buildIeehPatientFromEpicrisis
// ---------------------------------------------------------------------------

describe('buildIeehPatientFromEpicrisis', () => {
  it('extracts patient name and RUT from the document', () => {
    const patient = buildIeehPatientFromEpicrisis(baseDoc);

    expect(patient.patientName).toBe('Juan Pérez López');
    expect(patient.rut).toBe('11.111.111-1');
  });

  it('uses admissionDate from the document', () => {
    const patient = buildIeehPatientFromEpicrisis(baseDoc);

    expect(patient.admissionDate).toBe('2026-04-01');
  });

  it('uses specialty from the document', () => {
    const patient = buildIeehPatientFromEpicrisis(baseDoc);

    expect(patient.specialty).toBe('Medicina');
  });

  it('uses IEEH doctor specialty override without changing the epicrisis specialty', () => {
    const doc = {
      ...baseDoc,
      especialidad: 'Medicina',
      ieehDraft: buildDraft({ tratanteEspecialidad: 'Cirugía Adulto' }),
    };

    const patient = buildIeehPatientFromEpicrisis(doc);

    expect(patient.specialty).toBe('Cirugía Adulto');
    expect(doc.especialidad).toBe('Medicina');
  });

  it('uses workspace patient birthDate when available', () => {
    const patient = buildIeehPatientFromEpicrisis(baseDoc, { birthDate: '1990-05-15' });

    expect(patient.birthDate).toBe('1990-05-15');
  });

  it('falls back to patientField birthDate when workspace is absent', () => {
    const docWithField = {
      ...baseDoc,
      patientFields: [
        ...baseDoc.patientFields,
        { id: 'birthDate', label: 'Nacimiento', value: '1985-01-01', type: 'date' as const },
      ],
    };

    const patient = buildIeehPatientFromEpicrisis(docWithField);

    expect(patient.birthDate).toBe('1985-01-01');
  });

  it('defaults documentType to RUT when not in patientFields', () => {
    const patient = buildIeehPatientFromEpicrisis(baseDoc);

    expect(patient.documentType).toBe('RUT');
  });

  it('prefers visible edited patient fields over immutable document metadata', () => {
    const editedDoc = {
      ...baseDoc,
      patientName: 'Paciente anterior',
      patientRut: '11.111.111-1',
      admissionDate: '2026-04-01',
      patientFields: baseDoc.patientFields.map(field => {
        if (field.id === 'nombre') return { ...field, value: 'Paciente corregido' };
        if (field.id === 'rut') return { ...field, value: '22.222.222-2' };
        if (field.id === 'fecnac') return { ...field, value: '1980-02-03' };
        if (field.id === 'edad') return { ...field, value: '46' };
        if (field.id === 'fing') return { ...field, value: '2026-04-02' };
        return field;
      }),
    };

    const patient = buildIeehPatientFromEpicrisis(editedDoc, { birthDate: '1970-01-01' });

    expect(patient.patientName).toBe('Paciente corregido');
    expect(patient.rut).toBe('22.222.222-2');
    expect(patient.birthDate).toBe('1980-02-03');
    expect(patient.admissionDate).toBe('2026-04-02');
  });
});

// ---------------------------------------------------------------------------
// buildIeehDischargeFromEpicrisis
// ---------------------------------------------------------------------------

describe('buildIeehDischargeFromEpicrisis', () => {
  it('returns empty object when ieehDraft is undefined', () => {
    const discharge = buildIeehDischargeFromEpicrisis(baseDoc);

    expect(discharge).toEqual({});
  });

  it('maps CIE-10 and discharge condition from draft', () => {
    const doc = {
      ...baseDoc,
      ieehDraft: buildDraft({
        cie10Code: 'E11.5',
        cie10Description: 'Diabetes mellitus tipo 2',
        diagnosticoPrincipal: 'Diabetes mellitus tipo 2',
      }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.cie10Code).toBe('E11.5');
    expect(discharge.diagnosticoPrincipal).toBe('Diabetes mellitus tipo 2');
    expect(discharge.condicionEgreso).toBe('1');
  });

  it('uses the visible Fecha de alta field as discharge date before sourceDailyRecordDate', () => {
    const doc = {
      ...baseDoc,
      sourceDailyRecordDate: '2026-04-10',
      patientFields: baseDoc.patientFields.map(field =>
        field.id === 'finf' ? { ...field, value: '2026-04-11' } : field
      ),
      ieehDraft: buildDraft({
        cie10Code: 'J18.9',
        cie10Description: 'Neumonía',
        diagnosticoPrincipal: 'Neumonía',
      }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.dischargeDate).toBe('2026-04-11');
    expect(discharge.dischargeTime).toBeUndefined(); // blank for hand-fill
  });

  it('falls back to sourceDailyRecordDate when Fecha de alta is empty', () => {
    const doc = {
      ...baseDoc,
      sourceDailyRecordDate: '2026-04-10',
      patientFields: baseDoc.patientFields.map(field =>
        field.id === 'finf' ? { ...field, value: '' } : field
      ),
      ieehDraft: buildDraft({
        cie10Code: 'J18.9',
        cie10Description: 'Neumonía',
        diagnosticoPrincipal: 'Neumonía',
      }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.dischargeDate).toBe('2026-04-10');
    expect(discharge.dischargeTime).toBeUndefined(); // blank for hand-fill
  });

  it('splits doctor name into apellido1, apellido2, nombre', () => {
    const doc = {
      ...baseDoc,
      medico: 'Opazo Damiani Daniel',
      ieehDraft: buildDraft(),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteApellido1).toBe('Opazo');
    expect(discharge.tratanteApellido2).toBe('Damiani');
    expect(discharge.tratanteNombre).toBe('Daniel');
  });

  it('uses IEEH doctor name override in Nombre Apellido1 Apellido2 order', () => {
    const doc = {
      ...baseDoc,
      medico: 'Opazo Damiani Daniel',
      ieehDraft: buildDraft({ tratanteNombreCompleto: 'Ana María Pérez Soto' }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteApellido1).toBe('Pérez');
    expect(discharge.tratanteApellido2).toBe('Soto');
    expect(discharge.tratanteNombre).toBe('Ana María');
    expect(doc.medico).toBe('Opazo Damiani Daniel');
  });

  it('keeps IEEH doctor name blank when the override is explicitly blank', () => {
    const doc = {
      ...baseDoc,
      medico: 'Opazo Damiani Daniel',
      ieehDraft: buildDraft({ tratanteNombreCompleto: '' }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteApellido1).toBe('');
    expect(discharge.tratanteApellido2).toBe('');
    expect(discharge.tratanteNombre).toBe('');
  });

  it('maps tratanteRut from draft', () => {
    const doc = {
      ...baseDoc,
      ieehDraft: buildDraft({ tratanteRut: '12.345.678-9' }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteRut).toBe('12.345.678-9');
  });

  it('maps intervention and procedure flags', () => {
    const doc = {
      ...baseDoc,
      ieehDraft: buildDraft({
        cie10Code: 'K35.8',
        cie10Description: 'Apendicitis',
        diagnosticoPrincipal: 'Apendicitis aguda',
        intervencionQuirurgica: '1',
        intervencionQuirurgDescrip: 'Apendicectomía',
        procedimiento: '1',
        procedimientoDescrip: 'Laparoscopía',
      }),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.intervencionQuirurgica).toBe('1');
    expect(discharge.intervencionQuirurgDescrip).toBe('Apendicectomía');
    expect(discharge.procedimiento).toBe('1');
    expect(discharge.procedimientoDescrip).toBe('Laparoscopía');
  });

  it('handles doctor name with only one part', () => {
    const doc = {
      ...baseDoc,
      medico: 'Daniel',
      ieehDraft: buildDraft(),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteApellido1).toBe('Daniel');
    expect(discharge.tratanteApellido2).toBe('');
    expect(discharge.tratanteNombre).toBe('');
  });

  it('handles empty doctor name gracefully', () => {
    const doc = {
      ...baseDoc,
      medico: '',
      ieehDraft: buildDraft(),
    };

    const discharge = buildIeehDischargeFromEpicrisis(doc);

    expect(discharge.tratanteApellido1).toBe('');
    expect(discharge.tratanteNombre).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseDoctorName
// ---------------------------------------------------------------------------

describe('parseDoctorName', () => {
  it('parses three-part name into apellido1/apellido2/nombre', () => {
    const result = parseDoctorName('Opazo Damiani Daniel');

    expect(result.apellido1).toBe('Opazo');
    expect(result.apellido2).toBe('Damiani');
    expect(result.nombre).toBe('Daniel');
  });

  it('handles four-part name (compound first name)', () => {
    const result = parseDoctorName('García López María José');

    expect(result.apellido1).toBe('García');
    expect(result.apellido2).toBe('López');
    expect(result.nombre).toBe('María José');
  });

  it('handles two-part name (no second surname)', () => {
    const result = parseDoctorName('Pérez Juan');

    expect(result.apellido1).toBe('Pérez');
    expect(result.apellido2).toBe('');
    expect(result.nombre).toBe('Juan');
  });

  it('handles single-part name', () => {
    const result = parseDoctorName('Daniel');

    expect(result.apellido1).toBe('Daniel');
    expect(result.apellido2).toBe('');
    expect(result.nombre).toBe('');
  });

  it('returns empty parts for empty string', () => {
    const result = parseDoctorName('');

    expect(result.apellido1).toBe('');
    expect(result.apellido2).toBe('');
    expect(result.nombre).toBe('');
  });

  it('trims whitespace', () => {
    const result = parseDoctorName('  Opazo  Damiani  Daniel  ');

    expect(result.apellido1).toBe('Opazo');
    expect(result.apellido2).toBe('Damiani');
    expect(result.nombre).toBe('Daniel');
  });
});
