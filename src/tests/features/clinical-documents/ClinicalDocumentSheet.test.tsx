import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ClinicalDocumentSheet } from '@/features/clinical-documents/components/ClinicalDocumentSheet';
import { getDefaultClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { getClinicalDocumentPlanSubsectionTitle } from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import {
  buildDocument,
  buildPersonalIndicationsCatalog,
  buildToolbar,
  defaultHandlers,
  resetDefaultHandlers,
} from './ClinicalDocumentSheet.testSupport';

describe('ClinicalDocumentSheet', () => {
  beforeEach(() => {
    resetDefaultHandlers();
  });

  it('shows empty state when there is no selected document', () => {
    render(
      <ClinicalDocumentSheet
        selectedDocument={null}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={getDefaultClinicalDocumentIndicationsCatalog()}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(
      screen.getByText(/selecciona o crea un documento clínico para comenzar/i)
    ).toBeInTheDocument();
  });

  it('renders editor, local logos and delegates sheet actions', () => {
    const document = buildDocument();
    const personalCatalog = buildPersonalIndicationsCatalog([
      {
        id: 'general',
        label: 'General',
        items: [{ id: 'item-reposo', text: 'Reposo Absoluto', source: 'custom' as const }],
      },
    ]);
    Object.defineProperty(globalThis.document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
    });
    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[{ message: 'Falta completar diagnóstico.' }]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        activeTitleTarget="section:antecedentes"
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(screen.getByDisplayValue(document.medico)).toBeInTheDocument();
    expect(screen.queryByText(/revisión antes de imprimir o exportar/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/documento sin alertas obligatorias visibles/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/falta completar diagnóstico/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(getClinicalDocumentPlanSubsectionTitle('generales'))
    ).toBeInTheDocument();
    expect(
      screen.getByText(getClinicalDocumentPlanSubsectionTitle('farmacologicas'))
    ).toBeInTheDocument();
    expect(
      screen.getByText(getClinicalDocumentPlanSubsectionTitle('control_clinico'))
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /hay cambios remotos pendientes\. guarda o recarga el documento para sincronizar/i
      )
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recargar remoto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descartar local/i })).not.toBeInTheDocument();
    expect(screen.getByAltText(/logo institucional izquierdo/i)).toHaveAttribute(
      'src',
      '/images/logos/logo_HHR.png'
    );
    expect(screen.getByAltText(/logo institucional derecho/i)).toHaveAttribute(
      'src',
      '/images/logos/logo_SSMO.jpg'
    );
    expect(
      screen.queryByText(/aplica formato sobre la sección que tengas seleccionada/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /reestablecer plantilla/i }));
    fireEvent.click(screen.getByRole('button', { name: /formato/i }));
    expect(screen.getByRole('button', { name: /deshacer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /rehacer/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /negrita/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Reposo Absoluto$/i }));
    fireEvent.click(screen.getByRole('button', { name: /bajar sección antecedentes/i }));
    fireEvent.click(screen.getByRole('button', { name: /eliminar sección antecedentes/i }));
    expect(defaultHandlers.onPrint).toHaveBeenCalled();
    expect(defaultHandlers.onRestoreTemplate).toHaveBeenCalled();
    expect(defaultHandlers.patchSection).toHaveBeenCalledWith(
      'plan',
      expect.stringContaining('- Reposo Absoluto')
    );
    expect(defaultHandlers.moveSection).toHaveBeenCalledWith('antecedentes', 'down');
    expect(defaultHandlers.setSectionVisibility).toHaveBeenCalledWith('antecedentes', false);
    expect(screen.getByRole('button', { name: /^formato$/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('places episode files after the document sheet so they read as global episode context', () => {
    const document = buildDocument();
    const { container } = render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={getDefaultClinicalDocumentIndicationsCatalog()}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    const sheet = container.querySelector('#clinical-document-sheet');
    const attachmentsPanel = container.querySelector('.clinical-document-attachments-panel');

    expect(sheet).not.toBeNull();
    expect(attachmentsPanel).not.toBeNull();
    expect(sheet?.contains(attachmentsPanel)).toBe(false);
    expect(sheet?.compareDocumentPosition(attachmentsPanel as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('marks the active section and annex with stronger visual state', () => {
    const clinicalDocument = buildDocument();
    clinicalDocument.annexContent = '<p>Anexo activo</p>';

    render(
      <ClinicalDocumentSheet
        selectedDocument={clinicalDocument}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={getDefaultClinicalDocumentIndicationsCatalog()}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        activeEditorSectionId="annexes"
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(globalThis.document.querySelector('[data-clinical-section-id="annexes"]')).toHaveClass(
      'is-editor-active'
    );
    expect(screen.getByText(/paciente:/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('allows toggling annex global print and printing only the annex', () => {
    const clinicalDocument = buildDocument();
    clinicalDocument.annexContent = '<p>Anexo activo</p>';

    render(
      <ClinicalDocumentSheet
        selectedDocument={clinicalDocument}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={getDefaultClinicalDocumentIndicationsCatalog()}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /imprimir solo anexo/i }));

    expect(defaultHandlers.setAnnexIncludedInPrint).toHaveBeenCalledWith(false);
    expect(defaultHandlers.onPrintAnnex).toHaveBeenCalledTimes(1);
  });

  it('shows drive link and saved state when the PDF is exported to institutional drive', () => {
    const document = buildDocument();
    document.pdf = {
      exportStatus: 'exported',
      webViewLink: 'https://drive.google.com/test-file',
    };

    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={getDefaultClinicalDocumentIndicationsCatalog()}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(
      screen.getByRole('button', { name: /panel de indicaciones predeterminadas/i })
    ).toBeInTheDocument();
  });
});
