import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ClinicalDocumentsSidebar } from '@/features/clinical-documents/components/ClinicalDocumentsSidebar';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

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
        documents={[document]}
        selectedDocumentId={document.id}
        onSelectDocument={onSelectDocument}
        onDuplicateDocument={onDuplicateDocument}
        onDeleteDocument={onDeleteDocument}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /evolución médica 25\/05\/2026/i,
      })
    );
    expect(onSelectDocument).toHaveBeenCalledWith(document.id);

    fireEvent.click(screen.getByTitle(/duplicar documento/i));
    expect(onDuplicateDocument).toHaveBeenCalledWith(document);

    fireEvent.click(screen.getByTitle(/eliminar documento/i));
    expect(onDeleteDocument).toHaveBeenCalledWith(document);
    expect(screen.getByText('Evolución médica 25/05/2026')).toBeInTheDocument();
    expect(screen.getByText(/doctor test/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /agregar anexos/i }));

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

  it('restores one section from a version history snapshot', () => {
    const document = {
      ...buildDocument(),
      currentVersion: 2,
      versionHistory: [
        {
          version: 2,
          savedAt: '2026-04-24T10:00:00.000Z',
          savedBy: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
            role: 'doctor_urgency',
          },
          reason: 'manual' as const,
          changedSectionIds: ['evolucion'],
          sectionSnapshots: [
            {
              sectionId: 'evolucion',
              title: 'Evolución clínica',
              content: 'Texto anterior de evolución.',
              order: 1,
            },
          ],
        },
        {
          version: 1,
          savedAt: '2026-04-24T09:00:00.000Z',
          savedBy: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
            role: 'doctor_urgency',
          },
          reason: 'manual' as const,
          sectionSnapshots: [
            {
              sectionId: 'evolucion',
              title: 'Evolución clínica',
              content: 'Texto base de evolución.',
              order: 1,
            },
          ],
        },
      ],
    };
    const onRestoreVersionSection = vi.fn();

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
        onRestoreVersionSection={onRestoreVersionSection}
      />
    );

    fireEvent.click(screen.getByTitle(/ver historial de versiones/i));
    fireEvent.click(screen.getByRole('button', { name: /restaurar evolución clínica/i }));

    expect(onRestoreVersionSection).toHaveBeenCalledWith({
      sectionId: 'evolucion',
      title: 'Evolución clínica',
      content: 'Texto anterior de evolución.',
    });
  });

  it('does not show section-level changes when the latest version has no comparable snapshot', () => {
    const document = {
      ...buildDocument(),
      currentVersion: 2,
      sections: [
        {
          id: 'evolucion',
          title: 'Evolución clínica',
          content: 'Contenido actual recuperable.',
          order: 1,
        },
      ],
      versionHistory: [
        {
          version: 2,
          savedAt: '2026-04-25T09:40:00.000Z',
          savedBy: {
            uid: 'u1',
            email: 'doctor@test.com',
            displayName: 'Doctor Test',
            role: 'doctor_urgency',
          },
          reason: 'autosave' as const,
        },
      ],
    };

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
      />
    );

    fireEvent.click(screen.getByTitle(/ver historial de versiones/i));

    expect(screen.queryByText('Cambios')).not.toBeInTheDocument();
    expect(screen.queryByText('Evolución clínica')).not.toBeInTheDocument();
    expect(screen.queryByText(/versión sin detalle por sección/i)).not.toBeInTheDocument();
  });
});
