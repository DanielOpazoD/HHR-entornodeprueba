import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentVersionHistory } from '@/features/clinical-documents/components/ClinicalDocumentVersionHistory';
import type { ClinicalDocumentVersionMeta } from '@/domain/clinical-documents/entities';

const actor = {
  uid: 'u1',
  email: 'doc@test.cl',
  displayName: 'Doctor Test',
  role: 'doctor_urgency',
};

const makeVersion = (
  version: number,
  reason: ClinicalDocumentVersionMeta['reason'],
  savedAt = '2026-04-17T08:30:00.000Z'
): ClinicalDocumentVersionMeta => ({ version, savedAt, savedBy: actor, reason });

describe('ClinicalDocumentVersionHistory', () => {
  it('exposes the close icon button by its Spanish name', () => {
    const onClose = vi.fn();
    render(<ClinicalDocumentVersionHistory versions={[]} currentVersion={1} onClose={onClose} />);
    const button = screen.getByRole('button', { name: 'Cerrar' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives focus back to what opened it when closed from its button', () => {
    const Harness = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            v1
          </button>
          {open && (
            <ClinicalDocumentVersionHistory
              versions={[]}
              currentVersion={1}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    };
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'v1' });
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole('button', { name: 'Cerrar' });
    close.focus();
    fireEvent.click(close);

    expect(screen.queryByText('Historial de versiones')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('renders an empty-state when no versions are provided', () => {
    render(<ClinicalDocumentVersionHistory versions={[]} currentVersion={1} onClose={vi.fn()} />);

    expect(screen.getByText('Sin historial de versiones')).toBeInTheDocument();
    expect(screen.getByText(/Historial de versiones/)).toBeInTheDocument();
  });

  it('renders versions sorted descending and marks the current one', () => {
    const versions = [
      makeVersion(1, 'manual'),
      makeVersion(3, 'signature'),
      makeVersion(4, 'ai_import'),
      makeVersion(2, 'autosave'),
    ];

    render(
      <ClinicalDocumentVersionHistory versions={versions} currentVersion={2} onClose={vi.fn()} />
    );

    const versionMarks = Array.from(document.body.querySelectorAll('span.font-mono')).map(
      n => n.textContent
    );
    expect(versionMarks).toEqual(['v4', 'v3', 'v2', 'v1']);

    expect(screen.getByText('Importación IA')).toBeInTheDocument();
    expect(screen.getByText('Firmado')).toBeInTheDocument();
    expect(screen.getByText('Autoguardado')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('formats savedAt as DD/MM/YYYY HH:mm and falls back to raw string when invalid', () => {
    const versions = [
      makeVersion(1, 'manual', '2026-04-17T08:30:00.000Z'),
      makeVersion(2, 'autosave', 'not-a-date'),
    ];

    render(
      <ClinicalDocumentVersionHistory versions={versions} currentVersion={2} onClose={vi.fn()} />
    );

    expect(screen.getByText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText('not-a-date')).toBeInTheDocument();
  });

  it('uses the default config for an unknown reason label and icon', () => {
    const versions = [
      {
        version: 1,
        savedAt: '2026-04-17T08:30:00.000Z',
        savedBy: actor,
        reason: 'some-future-reason' as unknown as ClinicalDocumentVersionMeta['reason'],
      },
    ];

    render(
      <ClinicalDocumentVersionHistory versions={versions} currentVersion={1} onClose={vi.fn()} />
    );

    expect(screen.getByText('some-future-reason')).toBeInTheDocument();
  });

  it('invokes onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual')]}
        currentVersion={1}
        onClose={onClose}
      />
    );

    const closeButton = document.body.querySelector('button[type="button"]');
    fireEvent.click(closeButton as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual')]}
        currentVersion={1}
        onClose={onClose}
      />
    );

    const backdrop = document.body.querySelector('div.fixed.inset-0.bg-black\\/20');
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when Escape is pressed and detaches the listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual')]}
        currentVersion={1}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual')]}
        currentVersion={1}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows changed sections, previews previous content and restores one section', () => {
    const onRestoreSection = vi.fn();
    const previousVersion: ClinicalDocumentVersionMeta = {
      ...makeVersion(1, 'manual'),
      sectionSnapshots: [
        {
          sectionId: 'evolucion',
          title: 'Evolución clínica',
          content: 'Paciente en control previo.',
          order: 1,
        },
      ],
    };
    const version: ClinicalDocumentVersionMeta = {
      ...makeVersion(2, 'manual'),
      changedSectionIds: ['evolucion'],
      sectionSnapshots: [
        {
          sectionId: 'evolucion',
          title: 'Evolución clínica',
          content: 'Paciente afebril y en buenas condiciones.',
          order: 1,
        },
      ],
    };

    render(
      <ClinicalDocumentVersionHistory
        versions={[previousVersion, version]}
        currentVersion={3}
        onClose={vi.fn()}
        canRestoreSection={true}
        onRestoreSection={onRestoreSection}
      />
    );

    expect(screen.getByText(/cambios/i)).toBeInTheDocument();
    expect(screen.getByText(/evolución clínica/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver anterior evolución clínica/i }));
    expect(screen.getByText(/paciente afebril/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restaurar evolución clínica/i }));
    expect(onRestoreSection).toHaveBeenCalledWith({
      sectionId: 'evolucion',
      title: 'Evolución clínica',
      content: 'Paciente afebril y en buenas condiciones.',
    });
  });

  it('does not show the changes block when the previous version has no comparable snapshot', () => {
    const versionWithoutBaseline: ClinicalDocumentVersionMeta = {
      ...makeVersion(2, 'autosave'),
      changedSectionIds: ['evolucion'],
      sectionSnapshots: [
        {
          sectionId: 'evolucion',
          title: 'Evolución clínica',
          content: 'Contenido actual.',
          order: 1,
        },
      ],
    };

    render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual'), versionWithoutBaseline]}
        currentVersion={2}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText(/cambios/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/evolución clínica/i)).not.toBeInTheDocument();
  });

  it('shows section previews as readable plain text instead of stored html', () => {
    const version: ClinicalDocumentVersionMeta = {
      ...makeVersion(2, 'manual'),
      changedSectionIds: ['evolucion'],
      sectionSnapshots: [
        {
          sectionId: 'evolucion',
          title: 'Historia y evolución clínica',
          content: 'edfsasfadsfafa<div>dsfsdf}</div><div>sd</div><div>fsd</div><div>f</div>',
          order: 1,
        },
      ],
    };

    render(
      <ClinicalDocumentVersionHistory
        versions={[
          {
            ...makeVersion(1, 'manual'),
            sectionSnapshots: [
              {
                sectionId: 'evolucion',
                title: 'Historia y evolución clínica',
                content: 'Texto previo.',
                order: 1,
              },
            ],
          },
          version,
        ]}
        currentVersion={2}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /ver anterior historia y evolución clínica/i })
    );

    expect(screen.getByText(/edfsasfadsfafa/)).toBeInTheDocument();
    expect(screen.getByText(/dsfsdf}/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('<div>');
  });

  it('explains when a version has no section-level snapshot', () => {
    render(
      <ClinicalDocumentVersionHistory
        versions={[makeVersion(1, 'manual')]}
        currentVersion={1}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/sin detalle por sección/i)).toBeInTheDocument();
    expect(screen.getByText(/desde los próximos guardados/i)).toBeInTheDocument();
  });
});
