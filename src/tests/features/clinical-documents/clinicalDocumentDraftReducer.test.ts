import { describe, expect, it } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import {
  clinicalDocumentDraftReducer,
  createClinicalDocumentDraftReducerInitialState,
} from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';

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
      specialty: 'Cirugía',
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
    especialidad: 'Cirugía',
  });

describe('clinicalDocumentDraftReducer', () => {
  it('patches fields and sections through explicit actions', () => {
    const document = buildDocument();
    const initial = createClinicalDocumentDraftReducerInitialState();
    const loaded = clinicalDocumentDraftReducer(initial, {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const withField = clinicalDocumentDraftReducer(loaded, {
      type: 'PATCH_FIELD',
      fieldId: 'nombre',
      value: 'Paciente Editado',
    });
    const withSection = clinicalDocumentDraftReducer(withField, {
      type: 'PATCH_SECTION',
      sectionId: 'antecedentes',
      content: '<p>Nuevo contenido</p>',
    });

    expect(withSection.draft?.patientFields.find(field => field.id === 'nombre')?.value).toBe(
      'Paciente Editado'
    );
    expect(
      withSection.draft?.sections.find(section => section.id === 'antecedentes')?.content
    ).toBe('<p>Nuevo contenido</p>');
  });

  it('keeps section titles non-empty when a blank title is submitted', () => {
    const document = buildDocument();
    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const patched = clinicalDocumentDraftReducer(loaded, {
      type: 'PATCH_SECTION_TITLE',
      sectionId: 'antecedentes',
      title: '   ',
    });

    expect(patched.draft?.sections.find(section => section.id === 'antecedentes')?.title).toBe(
      'Antecedentes'
    );
  });

  it('stages remote updates and applies them explicitly', () => {
    const document = buildDocument();
    const remote = {
      ...buildDocument(),
      id: document.id,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T12:00:00.000Z',
      },
    };

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });
    const staged = clinicalDocumentDraftReducer(loaded, {
      type: 'REMOTE_UPDATE_RECEIVED',
      document: remote,
      snapshot: JSON.stringify(remote),
    });
    const applied = clinicalDocumentDraftReducer(staged, { type: 'APPLY_REMOTE_UPDATE' });

    expect(staged.hasPendingRemoteUpdate).toBe(true);
    expect(applied.hasPendingRemoteUpdate).toBe(false);
    expect(applied.draft?.audit.updatedAt).toBe('2026-03-06T12:00:00.000Z');
  });

  it('reorders visible sections without affecting hidden ones', () => {
    const document = buildDocument();
    document.sections = document.sections.map(section =>
      section.id === 'examenes-complementarios' ? { ...section, visible: false } : section
    );

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });
    const reordered = clinicalDocumentDraftReducer(loaded, {
      type: 'REORDER_SECTION',
      sourceSectionId: 'diagnosticos',
      targetSectionId: 'antecedentes',
    });

    expect(reordered.draft?.sections[0]?.id).toBe('diagnosticos');
    expect(
      reordered.draft?.sections.find(section => section.id === 'examenes-complementarios')?.order
    ).toBe((reordered.draft?.sections.length ?? 0) - 1);
  });

  it('updates the persisted base after autosave without overwriting a newer local draft', () => {
    const document = buildDocument();
    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const locallyEdited = clinicalDocumentDraftReducer(loaded, {
      type: 'PATCH_SECTION',
      sectionId: 'antecedentes',
      content: '<p>version local mas nueva</p>',
    });

    const autosaved = {
      ...document,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T12:30:00.000Z',
      },
    };

    const committed = clinicalDocumentDraftReducer(locallyEdited, {
      type: 'AUTOSAVE_COMMIT_BASE',
      document: autosaved,
      snapshot: JSON.stringify(autosaved),
    });

    expect(committed.draft?.sections.find(section => section.id === 'antecedentes')?.content).toBe(
      '<p>version local mas nueva</p>'
    );
    expect(committed.baseState.updatedAt).toBe('2026-03-06T12:30:00.000Z');
    expect(committed.isSaving).toBe(false);
  });

  it('marks autosave as clean without replacing the visible draft', () => {
    const document = buildDocument();
    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const autosaved = {
      ...document,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T12:45:00.000Z',
      },
    };

    const committed = clinicalDocumentDraftReducer(loaded, {
      type: 'AUTOSAVE_MARK_CLEAN',
      document: autosaved,
      snapshot: JSON.stringify(autosaved),
    });

    expect(committed.draft).toEqual(document);
    expect(committed.baseState.updatedAt).toBe('2026-03-06T12:45:00.000Z');
    expect(committed.baseState.document).toEqual(autosaved);
    expect(committed.baseState.snapshot).toBe(JSON.stringify(document));
    expect(committed.isSaving).toBe(false);
  });

  it('clears a staged remote update only when autosave commits the same snapshot', () => {
    const document = buildDocument();
    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const remote = {
      ...document,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T13:00:00.000Z',
      },
    };
    const remoteSnapshot = JSON.stringify(remote);
    const staged = clinicalDocumentDraftReducer(loaded, {
      type: 'REMOTE_UPDATE_RECEIVED',
      document: remote,
      snapshot: remoteSnapshot,
    });

    const otherAutosave = clinicalDocumentDraftReducer(staged, {
      type: 'AUTOSAVE_MARK_CLEAN',
      document: {
        ...document,
        audit: {
          ...document.audit,
          updatedAt: '2026-03-06T12:55:00.000Z',
        },
      },
      snapshot: JSON.stringify({
        ...document,
        audit: {
          ...document.audit,
          updatedAt: '2026-03-06T12:55:00.000Z',
        },
      }),
    });

    expect(otherAutosave.hasPendingRemoteUpdate).toBe(true);

    const matchingAutosave = clinicalDocumentDraftReducer(staged, {
      type: 'AUTOSAVE_MARK_CLEAN',
      document: remote,
      snapshot: remoteSnapshot,
    });

    expect(matchingAutosave.hasPendingRemoteUpdate).toBe(false);
    expect(matchingAutosave.pendingRemoteState.document).toBeNull();
  });

  it('keeps a staged remote update visible after restoring template content locally', () => {
    const document = buildDocument();
    document.sections = document.sections.map(section =>
      section.id === 'antecedentes'
        ? { ...section, content: '<p>Contenido local que se va a restaurar</p>' }
        : section
    );
    const remote = {
      ...document,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T13:15:00.000Z',
      },
    };

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });
    const staged = clinicalDocumentDraftReducer(loaded, {
      type: 'REMOTE_UPDATE_RECEIVED',
      document: remote,
      snapshot: JSON.stringify(remote),
    });
    const restored = clinicalDocumentDraftReducer(staged, {
      type: 'RESTORE_TEMPLATE_CONTENT',
    });

    expect(restored.hasPendingRemoteUpdate).toBe(true);
    expect(restored.pendingRemoteState.document?.audit.updatedAt).toBe('2026-03-06T13:15:00.000Z');
    expect(restored.draft?.sections.every(section => section.content === '')).toBe(true);
  });

  it('swaps the visible draft without clearing base or staged remote state', () => {
    const document = buildDocument();
    const visibleReplacement = {
      ...buildDocument(),
      id: `${document.id}-visible-replacement`,
      title: 'Borrador visible alternativo',
    };
    const remote = {
      ...document,
      audit: {
        ...document.audit,
        updatedAt: '2026-03-06T13:30:00.000Z',
      },
    };
    const originalSnapshot = JSON.stringify(document);

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: originalSnapshot,
    });
    const staged = clinicalDocumentDraftReducer(loaded, {
      type: 'REMOTE_UPDATE_RECEIVED',
      document: remote,
      snapshot: JSON.stringify(remote),
    });
    const swapped = clinicalDocumentDraftReducer(staged, {
      type: 'LOAD_DOCUMENT',
      document: visibleReplacement,
      snapshot: JSON.stringify(visibleReplacement),
      commitAsBase: false,
    });

    expect(swapped.draft?.title).toBe('Borrador visible alternativo');
    expect(swapped.baseState.snapshot).toBe(originalSnapshot);
    expect(swapped.hasPendingRemoteUpdate).toBe(true);
    expect(swapped.pendingRemoteState.document?.audit.updatedAt).toBe('2026-03-06T13:30:00.000Z');
  });

  it('restores the original template structure while preserving patient values', () => {
    const document = buildDocument();
    document.title = 'Título manual';
    document.patientInfoTitle = 'Datos clínicos resumidos';
    document.footerMedicoLabel = 'Profesional';
    document.sections = document.sections.map(section =>
      section.id === 'antecedentes'
        ? { ...section, title: 'Antecedentes reescritos', content: '<p>Texto editado</p>' }
        : { ...section, visible: false }
    );

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const restored = clinicalDocumentDraftReducer(loaded, {
      type: 'RESTORE_TEMPLATE_CONTENT',
    });

    expect(restored.draft?.title).toBe('Epicrisis médica');
    expect(restored.draft?.patientInfoTitle).toBe('Información del Paciente');
    expect(restored.draft?.footerMedicoLabel).toBe('Médico');
    expect(restored.draft?.sections.every(section => section.content === '')).toBe(true);
    expect(restored.draft?.sections.find(section => section.id === 'antecedentes')?.title).toBe(
      'Antecedentes'
    );
    expect(restored.draft?.patientFields.find(field => field.id === 'nombre')?.value).toBe(
      'Paciente Test'
    );
    expect(restored.draft?.pdf).toBeUndefined();
  });

  it('applies a new template to the current draft when the document type changes', () => {
    const document = buildDocument();
    document.sections = document.sections.map(section =>
      section.id === 'antecedentes'
        ? { ...section, content: '<p>Texto previo</p>' }
        : section.id === 'diagnosticos'
          ? { ...section, content: '<p>Diagnóstico al egreso</p>' }
          : section
    );

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document,
      snapshot: JSON.stringify(document),
    });

    const switched = clinicalDocumentDraftReducer(loaded, {
      type: 'APPLY_TEMPLATE',
      templateId: 'evolucion',
    });

    expect(switched.draft?.templateId).toBe('evolucion');
    expect(switched.draft?.documentType).toBe('evolucion');
    expect(switched.draft?.title).toMatch(/evoluci/i);
    // Sections with matching IDs preserve content across template change
    const antecedentes = switched.draft?.sections.find(s => s.id === 'antecedentes');
    if (antecedentes) {
      expect(antecedentes.content).toBe('<p>Texto previo</p>');
    }
    const diagnosticosActuales = switched.draft?.sections.find(s => s.id === 'diagnosticos');
    expect(diagnosticosActuales?.title).toBe('Diagnósticos actuales');
    expect(diagnosticosActuales?.content).toBe('<p>Diagnóstico al egreso</p>');
    // Sections without matching IDs start empty
    const newSections =
      switched.draft?.sections.filter(s => !['antecedentes', 'diagnosticos'].includes(s.id)) ?? [];
    expect(newSections.every(s => s.content === '')).toBe(true);
    expect(switched.draft?.patientFields.find(field => field.id === 'nombre')?.value).toBe(
      'Paciente Test'
    );
  });

  it('moves diagnosticos actuales into diagnosticos de egreso when switching from evolucion to epicrisis', () => {
    const evolutionDocument = createClinicalDocumentDraft({
      templateId: 'evolucion',
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
        specialty: 'Cirugía',
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
      especialidad: 'Cirugía',
    });
    evolutionDocument.sections = evolutionDocument.sections.map(section =>
      section.id === 'diagnosticos'
        ? { ...section, content: '<p>Diagnóstico actual vigente</p>' }
        : section
    );

    const loaded = clinicalDocumentDraftReducer(createClinicalDocumentDraftReducerInitialState(), {
      type: 'LOAD_DOCUMENT',
      document: evolutionDocument,
      snapshot: JSON.stringify(evolutionDocument),
    });

    const switched = clinicalDocumentDraftReducer(loaded, {
      type: 'APPLY_TEMPLATE',
      templateId: 'epicrisis',
    });

    const diagnosticosEgreso = switched.draft?.sections.find(s => s.id === 'diagnosticos');
    expect(diagnosticosEgreso?.title).toBe('Diagnósticos de egreso');
    expect(diagnosticosEgreso?.content).toBe('<p>Diagnóstico actual vigente</p>');
  });
});
