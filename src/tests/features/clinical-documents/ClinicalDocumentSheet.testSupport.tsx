import { vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { getDefaultClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';

export const buildDocument = () => {
  const draft = createClinicalDocumentDraft({
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
  return {
    ...draft,
    sections: draft.sections.map(section =>
      section.id === 'plan' ? { ...section, layout: 'structured' as const } : section
    ),
  };
};

export const buildToolbar = (handlers: { onPrint: () => void; onRestoreTemplate: () => void }) => (
  <>
    <button type="button" aria-label="PDF" onClick={handlers.onPrint}>
      PDF
    </button>
    <button type="button" aria-label="Reestablecer plantilla" onClick={handlers.onRestoreTemplate}>
      Reestablecer plantilla
    </button>
    <button type="button" aria-label="Formato" aria-pressed="true">
      Formato
    </button>
    <button type="button" aria-label="Deshacer" disabled>
      Deshacer
    </button>
    <button type="button" aria-label="Rehacer" disabled>
      Rehacer
    </button>
    <button type="button" aria-label="Negrita">
      Negrita
    </button>
    <button type="button" aria-label="Guardado en Drive">
      Guardado en Drive
    </button>
  </>
);

export const buildPersonalIndicationsCatalog = (
  tabs: Array<{
    id: string;
    label: string;
    items: Array<{ id: string; text: string; source: 'custom' }>;
  }>,
  activeTabId = tabs[0]?.id || 'general'
) => ({
  ...getDefaultClinicalDocumentIndicationsCatalog(),
  activeTabId,
  tabs,
  items: tabs.find(tab => tab.id === activeTabId)?.items || [],
});

export const defaultHandlers = {
  onPrint: vi.fn(),
  onUploadPdf: vi.fn(),
  hasLocalDraftChanges: false,
  flushPendingAutosave: vi.fn(),
  onRestoreTemplate: vi.fn(),
  activeTitleTarget: null,
  activeEditorSectionId: null,
  onSetActiveTitleTarget: vi.fn(),
  draggedSectionId: null,
  dragOverSectionId: null,
  activePlanSubsectionId: 'generales' as const,
  activeIndicationsSpecialtyId: 'tmt' as const,
  isIndicationsPanelOpen: false,
  onSetActivePlanSubsectionId: vi.fn(),
  onSetActiveIndicationsSpecialtyId: vi.fn(),
  onToggleIndicationsPanel: vi.fn(),
  onEditorActivate: vi.fn(),
  onEditorDeactivate: vi.fn(),
  onImagePasteRejected: vi.fn(),
  attachments: [],
  patientAttachments: [],
  isLoadingAttachments: false,
  isLoadingPatientAttachments: false,
  isUploadingAttachment: false,
  uploadStatusMessage: null,
  onUploadAttachment: vi.fn(async () => undefined),
  onDeleteAttachment: vi.fn(async () => undefined),
  onRenameAttachment: vi.fn(async () => undefined),
  onRegenerateAttachmentAccess: vi.fn(async () => undefined),
  onSuggestAttachmentName: vi.fn(async () => null),
  onUploadPastedImage: vi.fn(async () => null),
  dragHandlers: {
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDragEnd: vi.fn(),
  },
  patchDocumentTitle: vi.fn(),
  patchPatientInfoTitle: vi.fn(),
  patchPatientField: vi.fn(),
  patchPatientFieldLabel: vi.fn(),
  setPatientFieldVisibility: vi.fn(),
  patchSectionTitle: vi.fn(),
  patchSection: vi.fn(),
  setSectionLayout: vi.fn(),
  setSectionVisibility: vi.fn(),
  moveSection: vi.fn(),
  reorderSection: vi.fn(),
  addSection: vi.fn(),
  patchFooterLabel: vi.fn(),
  patchDocumentMeta: vi.fn(),
  createIndicationsTab: vi.fn(async () => true),
  renameIndicationsTab: vi.fn(async () => true),
  deleteIndicationsTab: vi.fn(async () => true),
  reorderIndicationsTab: vi.fn(async () => true),
  addCustomIndication: vi.fn(async () => true),
  updateIndication: vi.fn(async () => true),
  deleteIndication: vi.fn(async () => true),
  importIndicationsCatalog: vi.fn(async () => true),
  addClinicalUpdate: vi.fn(),
  patchAnnexContent: vi.fn(),
  setAnnexIncludedInPrint: vi.fn(),
  clearAnnexContent: vi.fn(),
  onPrintAnnex: vi.fn(),
  patchIeehDraft: vi.fn(),
  clearIeehDraft: vi.fn(),
  patchUpdateDate: vi.fn(),
  patchUpdateTime: vi.fn(),
};

export const resetDefaultHandlers = () => {
  Object.values(defaultHandlers).forEach(handler => {
    if (typeof handler === 'function' && 'mockClear' in handler) {
      handler.mockClear();
    }
  });
};
