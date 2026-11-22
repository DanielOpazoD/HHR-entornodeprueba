import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentSectionList } from '@/features/clinical-documents/components/ClinicalDocumentSectionList';
import { getDefaultClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

vi.mock('@/features/clinical-documents/components/InlineEditableTitle', () => ({
  InlineEditableTitle: ({
    value,
    onActivate,
    onChange,
  }: {
    value: string;
    onActivate: () => void;
    onChange: (value: string) => void;
  }) => (
    <div>
      <button type="button" onClick={onActivate}>
        activar-{value}
      </button>
      <button type="button" onClick={() => onChange(`${value}-editado`)}>
        editar-{value}
      </button>
    </div>
  ),
}));

vi.mock('@/features/clinical-documents/components/clinicalDocumentSectionRendererRegistry', () => ({
  renderClinicalDocumentSectionContent: ({ section }: { section: { id: string } }) => (
    <div>contenido-{section.id}</div>
  ),
}));

vi.mock('@/features/clinical-documents/components/ClinicalDocumentIndicationsPanel', () => ({
  ClinicalDocumentIndicationsPanel: ({ onToggle }: { onToggle: () => void }) => (
    <button type="button" onClick={onToggle}>
      indicaciones
    </button>
  ),
}));

vi.mock('@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController', () => ({
  appendClinicalDocumentPlanSubsectionText: vi.fn(() => 'plan-apendado'),
  buildStructuredClinicalDocumentPlanSectionContent: vi.fn(() => 'plan-structured'),
  buildUnifiedClinicalDocumentPlanSectionContent: vi.fn(() => 'plan-unified'),
  resolveClinicalDocumentPlanSectionLayout: vi.fn(() => 'unified'),
}));

const document = {
  ...createClinicalDocumentDraft({
    hospitalId: 'hhr',
    actor: {
      uid: 'user-1',
      email: 'doctor@example.com',
      displayName: 'Doctor',
      role: 'medico',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: 'episodio-1',
    },
    patientFieldValues: {},
    medico: 'Doctor',
    especialidad: 'Medicina',
  }),
  documentType: 'epicrisis' as const,
  sections: [
    {
      id: 'intro',
      title: 'Introducción',
      content: 'Intro',
      order: 0,
      visible: true,
    },
    {
      id: 'plan',
      title: 'Plan',
      content: 'Contenido inicial',
      order: 1,
      visible: true,
    },
    {
      id: 'egreso',
      title: 'Egreso',
      content: 'Alta',
      order: 2,
      visible: true,
    },
  ],
};

describe('ClinicalDocumentSectionList', () => {
  it('wires section editing, insertion and ordering actions for editable plan sections', () => {
    const onSetActiveTitleTarget = vi.fn();
    const onPatchSectionTitle = vi.fn();
    const onPatchSection = vi.fn();
    const onSetSectionLayout = vi.fn();
    const onSetSectionVisibility = vi.fn();
    const onMoveSection = vi.fn();
    const onReorderSection = vi.fn();
    const onAddSection = vi.fn();
    const onToggleIndicationsPanel = vi.fn();

    render(
      <ClinicalDocumentSectionList
        document={document}
        visibleSections={document.sections}
        canEdit={true}
        sectionActions={{
          patchSectionTitle: onPatchSectionTitle,
          patchSection: onPatchSection,
          setSectionLayout: onSetSectionLayout,
          setSectionVisibility: onSetSectionVisibility,
          moveSection: onMoveSection,
          reorderSection: onReorderSection,
          addSection: onAddSection,
        }}
        editorState={{
          activeTitleTarget: 'section:plan',
          activeEditorSectionId: null,
          onSetActiveTitleTarget,
          draggedSectionId: null,
          dragOverSectionId: null,
          dragHandlers: {
            onDragStart: vi.fn(),
            onDragOver: vi.fn(),
            onDragLeave: vi.fn(),
            onDragEnd: vi.fn(),
          },
          activePlanSubsectionId: 'generales',
          onSetActivePlanSubsectionId: vi.fn(),
          onEditorActivate: vi.fn(),
          onEditorDeactivate: vi.fn(),
          onUploadPastedImage: vi.fn(async () => null),
          onImagePasteRejected: vi.fn(),
        }}
        indications={{
          catalog: getDefaultClinicalDocumentIndicationsCatalog('2026-04-04T00:00:00.000Z'),
          isSavingCustomIndication: false,
          customIndicationError: null,
          isPanelOpen: false,
          onTogglePanel: onToggleIndicationsPanel,
          onCreateTab: vi.fn(),
          onRenameTab: vi.fn(),
          onDeleteTab: vi.fn(),
          onAddCustomIndication: vi.fn(),
          onUpdateIndication: vi.fn(),
          onDeleteIndication: vi.fn(),
          onImportCatalog: vi.fn(),
        }}
        ieeh={{
          onPatchDraft: vi.fn(),
          onClearDraft: vi.fn(),
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'editar-Plan' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: /Volver a indicaciones al alta estructuradas/i,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'indicaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insertar sección' }));
    fireEvent.click(screen.getByRole('button', { name: /Insertar arriba/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insertar sección' }));
    fireEvent.click(screen.getByRole('button', { name: /Insertar abajo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Subir sección Plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bajar sección Plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /Eliminar sección Plan/i }));

    expect(onPatchSectionTitle).toHaveBeenCalledWith('plan', 'Plan-editado');
    expect(onSetSectionLayout).toHaveBeenCalledWith('plan', 'structured');
    expect(onPatchSection).toHaveBeenCalledWith('plan', 'plan-structured');
    expect(onToggleIndicationsPanel).toHaveBeenCalledTimes(1);
    expect(onAddSection).toHaveBeenCalledWith('plan', 'above');
    expect(onAddSection).toHaveBeenCalledWith('plan', 'below');
    expect(onMoveSection).toHaveBeenCalledWith('plan', 'up');
    expect(onMoveSection).toHaveBeenCalledWith('plan', 'down');
    expect(onSetActiveTitleTarget).toHaveBeenCalledWith('section:plan');
    expect(onSetSectionVisibility).toHaveBeenCalledWith('plan', false);
    expect(screen.getByText('contenido-plan')).toBeInTheDocument();
  });
});
