// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveAutosaveIndicatorState } from '@/features/clinical-documents/components/ClinicalDocumentStatusBar';
import { resolveClinicalDocumentInsertTarget } from '@/features/clinical-documents/components/ClinicalDocumentsWorkspace';
import { createClinicalUpdateSection } from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';
import { validateClinicalDocument } from '@/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import {
  buildClinicalDocumentEpisodeContext,
  buildClinicalDocumentPatientFieldValues,
} from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { ClinicalDocumentSection } from '@/domain/clinical-documents/entities';

describe('resolveAutosaveIndicatorState', () => {
  it('returns "saving" phase when isSaving is true', () => {
    const state = resolveAutosaveIndicatorState(true, false, '2026-04-11T19:00:00Z');

    expect(state.phase).toBe('saving');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saving" phase even if isDirty is true', () => {
    const state = resolveAutosaveIndicatorState(true, true, undefined);

    expect(state.phase).toBe('saving');
  });

  it('returns "dirty" phase when isDirty is true and not saving', () => {
    const state = resolveAutosaveIndicatorState(false, true, '2026-04-11T19:00:00Z');

    expect(state.phase).toBe('dirty');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saved" phase with formatted time when save completed', () => {
    const state = resolveAutosaveIndicatorState(false, false, '2026-04-11T19:17:00Z');

    expect(state.phase).toBe('saved');
    expect(state.savedAtLabel).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns "idle" phase when no activity', () => {
    const state = resolveAutosaveIndicatorState(false, false, undefined);

    expect(state.phase).toBe('idle');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saved" with empty label for malformed timestamp', () => {
    const state = resolveAutosaveIndicatorState(false, false, 'not-a-date');

    expect(state.phase).toBe('saved');
    expect(state.savedAtLabel).toBe('');
  });

  it('returns "idle" phase for empty string timestamp', () => {
    const state = resolveAutosaveIndicatorState(false, false, '');

    expect(state.phase).toBe('idle');
  });

  it('prioritizes saving over dirty', () => {
    const state = resolveAutosaveIndicatorState(true, true, '2026-04-11T10:00:00Z');

    expect(state.phase).toBe('saving');
  });

  it('prioritizes dirty over saved', () => {
    const state = resolveAutosaveIndicatorState(false, true, '2026-04-11T10:00:00Z');

    expect(state.phase).toBe('dirty');
  });
});

describe('resolveClinicalDocumentInsertTarget', () => {
  const buildDocument = () =>
    createClinicalDocumentDraft({
      templateId: 'epicrisis',
      hospitalId: 'hhr',
      actor: {
        uid: 'u1',
        email: 'doctor@test.com',
        displayName: 'Doctor Test',
        role: 'doctor_urgency',
      },
      episode: {
        patientRut: '11.111.111-1',
        patientName: 'Paciente Test',
        episodeKey: '11.111.111-1__2026-03-06',
        admissionDate: '2026-03-06',
        sourceDailyRecordDate: '2026-03-06',
        sourceBedId: 'R1',
        specialty: 'Medicina',
      },
      patientFieldValues: {
        nombre: 'Paciente Test',
        rut: '11.111.111-1',
        edad: '40a',
        fecnac: '1986-01-01',
        fing: '2026-03-06',
        finf: '2026-03-06',
        hinf: '10:30',
      },
      medico: 'Doctor Test',
      especialidad: 'Medicina',
    });

  it('inserts external clinical text into the active visible editor section', () => {
    const document = buildDocument();
    document.sections = document.sections.map(section => ({
      ...section,
      content: section.id === 'antecedentes' ? 'Texto previo' : '',
    }));

    expect(
      resolveClinicalDocumentInsertTarget({
        document,
        activeEditorSectionId: 'antecedentes',
        text: '<p>Laboratorio resumido</p>',
      })
    ).toEqual({
      sectionId: 'antecedentes',
      content: 'Texto previo<br><p>Laboratorio resumido</p>',
    });
  });

  it('falls back to the first visible section when no active editor can receive the text', () => {
    const document = buildDocument();
    document.sections = document.sections.map((section, index) => ({
      ...section,
      visible: index === 0 ? false : true,
      content: '',
    }));

    expect(
      resolveClinicalDocumentInsertTarget({
        document,
        activeEditorSectionId: 'annexes',
        text: '<p>Laboratorio resumido</p>',
      })
    ).toEqual({
      sectionId: document.sections[1].id,
      content: '<p>Laboratorio resumido</p>',
    });
  });
});

describe('createClinicalUpdateSection', () => {
  const existingSections: ClinicalDocumentSection[] = [
    { id: 'antecedentes', title: 'Antecedentes', content: '', order: 1, visible: true },
    { id: 'historia', title: 'Historia', content: '', order: 2, visible: true },
  ];

  it('creates a section with kind clinical-update', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.kind).toBe('clinical-update');
  });

  it('sets order higher than all existing sections', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.order).toBeGreaterThan(2);
  });

  it('auto-populates updateDate in YYYY-MM-DD format', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.updateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('auto-populates updateTime in HH:MM format', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.updateTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('generates unique IDs for multiple updates', () => {
    const first = createClinicalUpdateSection(existingSections);
    const withFirst = [...existingSections, first];
    const second = createClinicalUpdateSection(withFirst);
    expect(first.id).not.toBe(second.id);
  });

  it('starts with empty content', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.content).toBe('');
  });

  it('is visible and not required', () => {
    const section = createClinicalUpdateSection(existingSections);
    expect(section.visible).toBe(true);
    expect(section.required).toBe(false);
  });

  it('handles empty existing sections', () => {
    const section = createClinicalUpdateSection([]);
    expect(section.order).toBe(1);
  });
});

describe('validateClinicalDocument', () => {
  const patient = DataFactory.createMockPatient('R1');
  const actor = {
    uid: 'u1',
    email: 'doctor@hospitalhangaroa.cl',
    displayName: 'Doctor Prueba',
    role: 'doctor_urgency',
  };

  it('accepts a complete epicrisis draft', () => {
    const record = createClinicalDocumentDraft({
      hospitalId: 'h1',
      actor,
      episode: buildClinicalDocumentEpisodeContext(patient, '2026-03-04', 'R1'),
      patientFieldValues: buildClinicalDocumentPatientFieldValues(patient),
      medico: 'Dr Test',
      especialidad: 'Medicina Interna',
    });

    const complete = {
      ...record,
      sections: record.sections.map(section =>
        section.required ? { ...section, content: `${section.title} completo` } : section
      ),
    };

    expect(validateClinicalDocument(complete)).toEqual([]);
  });

  it('flags missing required patient fields and sections', () => {
    const record = createClinicalDocumentDraft({
      hospitalId: 'h1',
      actor,
      episode: buildClinicalDocumentEpisodeContext(patient, '2026-03-04', 'R1'),
      patientFieldValues: buildClinicalDocumentPatientFieldValues(patient),
      medico: '',
      especialidad: '',
    });

    const invalid = {
      ...record,
      patientFields: record.patientFields.map(field =>
        field.id === 'nombre' ? { ...field, value: '' } : field
      ),
    };

    const issues = validateClinicalDocument(invalid);

    expect(issues.some(issue => issue.path === 'patientFields.nombre')).toBe(true);
    expect(issues.some(issue => issue.path === 'medico')).toBe(true);
    expect(issues.some(issue => issue.path === 'especialidad')).toBe(true);
    expect(issues.some(issue => issue.path === 'sections.antecedentes')).toBe(true);
  });
});
