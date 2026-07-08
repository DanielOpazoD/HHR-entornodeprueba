import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClinicalDocumentSheet } from '@/features/clinical-documents/components/ClinicalDocumentSheet';
import {
  buildDocument,
  buildPersonalIndicationsCatalog,
  buildToolbar,
  defaultHandlers,
  resetDefaultHandlers,
} from './ClinicalDocumentSheet.testSupport';

describe('ClinicalDocumentSheet personal indications', () => {
  beforeEach(() => {
    resetDefaultHandlers();
  });

  it('shows personal default indications without specialty tabs', async () => {
    const document = buildDocument();
    const personalCatalog = buildPersonalIndicationsCatalog([
      {
        id: 'general',
        label: 'General',
        items: [{ id: 'item-1', text: 'Reposo relativo personalizado', source: 'custom' as const }],
      },
      {
        id: 'farmacos',
        label: 'Fármacos',
        items: [],
      },
    ]);

    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(screen.getByRole('heading', { name: /mis indicaciones/i })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /especialidades/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /fármacos/i })).toBeInTheDocument();
    expect(screen.getByText('Reposo relativo personalizado')).toBeInTheDocument();
    expect(screen.queryByText('Propia')).not.toBeInTheDocument();
  });

  it('allows managing personal indication tabs', async () => {
    const document = buildDocument();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const personalCatalog = buildPersonalIndicationsCatalog([
      {
        id: 'general',
        label: 'General',
        items: [],
      },
      {
        id: 'farmacos',
        label: 'Fármacos',
        items: [],
      },
    ]);

    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(screen.queryByLabelText(/nueva pestaña de indicaciones/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /renombrar pestaña general/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /eliminar pestaña fármacos/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mover pestaña fármacos a la izquierda/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /mover pestaña general a la derecha/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /agregar nueva indicación/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /configurar pestañas/i }));
    fireEvent.change(screen.getByLabelText(/nueva pestaña de indicaciones/i), {
      target: { value: 'Post operatorio' },
    });
    fireEvent.click(screen.getByRole('button', { name: /crear pestaña de indicaciones/i }));
    await waitFor(() => {
      expect(defaultHandlers.createIndicationsTab).toHaveBeenCalledWith('Post operatorio');
    });

    fireEvent.click(screen.getByRole('button', { name: /renombrar pestaña general/i }));
    fireEvent.change(screen.getByDisplayValue('General'), {
      target: { value: 'Generales alta' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar nombre de pestaña general/i }));
    await waitFor(() => {
      expect(defaultHandlers.renameIndicationsTab).toHaveBeenCalledWith(
        'general',
        'Generales alta'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /eliminar pestaña fármacos/i }));
    expect(defaultHandlers.deleteIndicationsTab).toHaveBeenCalledWith('farmacos');
    expect(confirmSpy).toHaveBeenCalledWith(
      '¿Eliminar la pestaña "Fármacos" y sus indicaciones guardadas? Esta acción no se puede deshacer.'
    );

    confirmSpy.mockRestore();
  });

  it('allows adding a custom personal indication into the active tab', async () => {
    const document = buildDocument();
    const personalCatalog = buildPersonalIndicationsCatalog(
      [
        {
          id: 'farmacos',
          label: 'Fármacos',
          items: [],
        },
      ],
      'farmacos'
    );

    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    expect(screen.queryByLabelText(/agregar propia/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /agregar nueva indicación/i }));
    fireEvent.change(screen.getByLabelText(/agregar propia/i), {
      target: { value: 'Curación diaria de herida' },
    });
    fireEvent.click(screen.getByRole('button', { name: /agregar\+/i }));

    await waitFor(() => {
      expect(defaultHandlers.addCustomIndication).toHaveBeenCalledWith(
        'farmacos',
        'Curación diaria de herida'
      );
    });
  });

  it('allows editing and deleting personal indications', async () => {
    const document = buildDocument();
    const personalCatalog = buildPersonalIndicationsCatalog(
      [
        {
          id: 'postop',
          label: 'Post operatorio',
          items: [
            { id: 'personal-1', text: 'Reposo personalizado', source: 'custom' as const },
            { id: 'personal-2', text: 'Control personalizado', source: 'custom' as const },
          ],
        },
      ],
      'postop'
    );

    render(
      <ClinicalDocumentSheet
        selectedDocument={document}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /editar indicación reposo personalizado/i })
    );
    fireEvent.change(screen.getByDisplayValue('Reposo personalizado'), {
      target: { value: 'Reposo en domicilio' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /guardar indicación reposo personalizado/i })
    );

    await waitFor(() => {
      expect(defaultHandlers.updateIndication).toHaveBeenCalledWith(
        'postop',
        'personal-1',
        'Reposo en domicilio'
      );
    });

    fireEvent.click(
      screen.getByRole('button', { name: /^Eliminar indicación Control personalizado$/i })
    );

    await waitFor(() => {
      expect(defaultHandlers.deleteIndication).toHaveBeenCalledWith('postop', 'personal-2');
    });
  });

  it('inserts a personal indication without changing unified plan into structured sections', () => {
    const document = buildDocument();
    const unifiedDocument = {
      ...document,
      sections: document.sections.map(section =>
        section.id === 'plan'
          ? { ...section, layout: 'unified' as const, content: '<div>Indicaciones previas</div>' }
          : section
      ),
    };
    const personalCatalog = buildPersonalIndicationsCatalog([
      {
        id: 'general',
        label: 'General',
        items: [{ id: 'item-reposo', text: 'Reposo Absoluto', source: 'custom' as const }],
      },
    ]);

    render(
      <ClinicalDocumentSheet
        selectedDocument={unifiedDocument}
        canEdit={true}
        isSaving={false}
        isUploadingPdf={false}
        validationIssues={[]}
        indicationsCatalog={personalCatalog}
        isSavingCustomIndication={false}
        customIndicationError={null}
        {...defaultHandlers}
        isIndicationsPanelOpen={true}
        toolbar={buildToolbar(defaultHandlers)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Reposo Absoluto$/i }));

    expect(defaultHandlers.patchSection).toHaveBeenCalledWith(
      'plan',
      expect.stringContaining('- Reposo Absoluto')
    );
    expect(defaultHandlers.patchSection).toHaveBeenCalledWith(
      'plan',
      expect.not.stringContaining('Indicaciones farmacológicas')
    );
  });
});
