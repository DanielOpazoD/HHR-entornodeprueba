import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ClinicalDocumentsSidebar } from '@/features/clinical-documents/components/ClinicalDocumentsSidebar';
import { buildDocument } from './ClinicalDocumentsSidebar.testSupport';

describe('ClinicalDocumentsSidebar version history', () => {
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
