import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ClinicalDocumentsSidebar } from '@/features/clinical-documents/components/ClinicalDocumentsSidebar';
import { buildDocument } from './ClinicalDocumentsSidebar.testSupport';

describe('ClinicalDocumentsSidebar', () => {
  it('shows read-only notice and disables create without patient name', () => {
    render(
      <ClinicalDocumentsSidebar
        canEdit={false}
        canDelete={false}
        readOnlyMessage="Perfil en solo lectura: puedes revisar e imprimir, pero no crear nuevos documentos."
        patientName=""
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[]}
        selectedDocumentId={null}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
      />
    );

    expect(screen.getByText(/perfil en solo lectura/i)).toBeInTheDocument();
    expect(screen.queryByText(/^nuevo documento$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^crear documento$/i })).toBeDisabled();
  });

  it('renders documents with their saved title and delegates selection and deletion', () => {
    const document = { ...buildDocument(), title: 'Evolución médica 25/05/2026' };
    const otherDocument = { ...document, id: 'other-document', title: 'Control médico' };
    const onSelectDocument = vi.fn();
    const onDuplicateDocument = vi.fn();
    const onDeleteDocument = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={true}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document, otherDocument]}
        selectedDocumentId={document.id}
        onSelectDocument={onSelectDocument}
        onDuplicateDocument={onDuplicateDocument}
        onDeleteDocument={onDeleteDocument}
      />
    );

    const selectedDocument = screen.getByRole('button', {
      name: /evolución médica 25\/05\/2026/i,
      pressed: true,
    });
    expect(
      screen.getByRole('button', { name: /control médico/i, pressed: false })
    ).toBeInTheDocument();
    fireEvent.click(selectedDocument);
    expect(onSelectDocument).toHaveBeenCalledWith(document.id);

    const duplicateActions = screen.getAllByRole('button', { name: 'Duplicar documento' });
    duplicateActions[0].focus();
    expect(duplicateActions[0]).toHaveFocus();
    fireEvent.click(duplicateActions[0]);
    expect(onDuplicateDocument).toHaveBeenCalledWith(document);

    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar documento' })[0]);
    expect(onDeleteDocument).toHaveBeenCalledWith(document);
    expect(screen.getByText('Evolución médica 25/05/2026')).toBeInTheDocument();
    expect(screen.getAllByText(/doctor test/i)).toHaveLength(2);
    expect(screen.queryByText(/borrador/i)).not.toBeInTheDocument();
  });

  it('allows the current author delete action even when global delete is disabled', () => {
    const document = buildDocument();
    const onDeleteDocument = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        canDeleteDocument={candidate => candidate.id === document.id}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={onDeleteDocument}
      />
    );

    fireEvent.click(screen.getByTitle(/eliminar documento/i));

    expect(onDeleteDocument).toHaveBeenCalledWith(document);
  });

  it('hides the delete action when both global and per-document guards deny it', () => {
    const document = buildDocument();
    const onDeleteDocument = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        canDeleteDocument={() => false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={onDeleteDocument}
      />
    );

    expect(screen.queryByTitle(/eliminar documento/i)).not.toBeInTheDocument();
    expect(onDeleteDocument).not.toHaveBeenCalled();
  });

  it('shows closed-episode notice while keeping the selected document visible', () => {
    const document = buildDocument();

    render(
      <ClinicalDocumentsSidebar
        canEdit={false}
        canDelete={false}
        readOnlyMessage="Episodio cerrado por alta: solo ADMIN puede crear, editar o eliminar documentos."
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
      />
    );

    expect(screen.getByText(/episodio cerrado por alta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^crear documento$/i })).toBeDisabled();
    expect(screen.queryByTitle(/eliminar documento/i)).not.toBeInTheDocument();
  });

  it('groups clinical insert shortcuts inside an insert tray', () => {
    const onOpenLabDialog = vi.fn();
    const onOpenMMRADDialog = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        patientRut="11.111.111-1"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[]}
        selectedDocumentId={null}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
        onOpenLabDialog={onOpenLabDialog}
        onOpenMMRADDialog={onOpenMMRADDialog}
      />
    );

    expect(screen.queryByRole('button', { name: /laboratorio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /imagenología mmrad/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /insertar contenido/i }));

    fireEvent.click(screen.getByRole('button', { name: /laboratorio/i }));

    fireEvent.click(screen.getByRole('button', { name: /insertar contenido/i }));
    fireEvent.click(screen.getByRole('button', { name: /imagenología mmrad/i }));

    expect(onOpenLabDialog).toHaveBeenCalledTimes(1);
    expect(onOpenMMRADDialog).toHaveBeenCalledTimes(1);
  });

  it('labels the annex shortcut as an add-annexes action', () => {
    const document = buildDocument();
    const onToggleAnnex = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
        onToggleAnnex={onToggleAnnex}
      />
    );

    expect(
      screen.queryByRole('button', { name: /documento complementario/i })
    ).not.toBeInTheDocument();
    const annexAction = screen.getByRole('button', { name: /agregar anexos/i });
    expect(annexAction).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(annexAction);

    expect(onToggleAnnex).toHaveBeenCalledTimes(1);
  });

  it('keeps json import/export in an advanced tools group', () => {
    const document = buildDocument();
    const onExportJson = vi.fn();
    const onImportJson = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
        onExportJson={onExportJson}
        onImportJson={onImportJson}
      />
    );

    expect(screen.queryByRole('button', { name: /exportar json/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /herramientas avanzadas/i }));
    fireEvent.click(screen.getByRole('button', { name: /exportar json/i }));
    fireEvent.change(screen.getByLabelText(/archivo json de documento clínico/i), {
      target: {
        files: [
          new File([JSON.stringify({ ok: true })], 'documento.json', { type: 'application/json' }),
        ],
      },
    });

    expect(onExportJson).toHaveBeenCalledWith(document);
    expect(onImportJson).toHaveBeenCalledWith(expect.any(File));
  });

  it('offers AI import for PDF and DOCX files from advanced tools', () => {
    const onImportWithAi = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[]}
        selectedDocumentId={null}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
        onImportWithAi={onImportWithAi}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /herramientas avanzadas/i }));
    expect(screen.getByRole('button', { name: /importar con ia/i })).toBeEnabled();
    expect(screen.getByLabelText(/archivo pdf o docx para importar con ia/i)).toHaveAttribute(
      'accept',
      '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    fireEvent.change(screen.getByLabelText(/archivo pdf o docx para importar con ia/i), {
      target: {
        files: [new File(['contenido'], 'traslado.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onImportWithAi).toHaveBeenCalledWith(expect.any(File));
  });

  it('disables AI import while a file is being transformed', () => {
    const onImportWithAi = vi.fn();

    render(
      <ClinicalDocumentsSidebar
        canEdit={true}
        canDelete={false}
        readOnlyMessage={null}
        patientName="Paciente Test"
        templates={[{ id: 'epicrisis', name: 'Epicrisis' }]}
        selectedTemplateId="epicrisis"
        onSelectTemplate={() => {}}
        onCreateDocument={() => {}}
        documents={[]}
        selectedDocumentId={null}
        onSelectDocument={() => {}}
        onDuplicateDocument={() => {}}
        onDeleteDocument={() => {}}
        onImportWithAi={onImportWithAi}
        isImportingWithAi={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /herramientas avanzadas/i }));

    expect(screen.getByRole('button', { name: /importando con ia/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/archivo pdf o docx para importar con ia/i), {
      target: {
        files: [new File(['contenido'], 'traslado.pdf', { type: 'application/pdf' })],
      },
    });

    expect(onImportWithAi).not.toHaveBeenCalled();
  });
});
