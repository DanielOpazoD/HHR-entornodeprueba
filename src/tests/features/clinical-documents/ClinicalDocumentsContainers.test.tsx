import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient as appQueryClient } from '@/config/queryClient';
import { ClinicalDocumentsModal } from '@/features/clinical-documents/components/ClinicalDocumentsModal';
import { ClinicalDocumentsPanel } from '@/features/clinical-documents/components/ClinicalDocumentsPanel';

const workspaceSpy = vi.fn();

vi.mock('@/features/clinical-documents/components/ClinicalDocumentsWorkspace', () => ({
  ClinicalDocumentsWorkspace: (props: unknown) => {
    workspaceSpy(props);
    return <div data-testid="clinical-documents-workspace">workspace</div>;
  },
}));

const patient = {
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  admissionDate: '2026-03-06',
} as const;

describe('ClinicalDocuments containers', () => {
  beforeEach(() => {
    workspaceSpy.mockClear();
  });

  it('renders modal header metadata and forwards the active workspace context', () => {
    render(
      <ClinicalDocumentsModal
        isOpen={true}
        onClose={vi.fn()}
        patient={patient as never}
        currentDateString="2026-03-13"
        bedId="B-12"
      />
    );

    expect(screen.getByText('Documentos Clínicos')).toBeInTheDocument();
    expect(screen.getByTestId('clinical-documents-workspace')).toBeInTheDocument();
    expect(workspaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        patient,
        currentDateString: '2026-03-13',
        bedId: 'B-12',
        isActive: true,
      })
    );
  });

  it('renders the side panel shell with episode context and a permanently active workspace', () => {
    render(
      <ClinicalDocumentsPanel
        patient={patient as never}
        currentDateString="2026-03-13"
        bedId="B-12"
      />
    );

    expect(screen.getByText('Documentos Clínicos')).toBeInTheDocument();
    expect(
      screen.getByText(/Paciente Test · 11.111.111-1 · 11\.111\.111-1__2026-03-06/i)
    ).toBeInTheDocument();
    expect(workspaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );
  });

  it('refreshes the census document badges once when the workspace closes', () => {
    const invalidate = vi.spyOn(appQueryClient, 'invalidateQueries').mockResolvedValue();
    const props = {
      onClose: vi.fn(),
      patient: patient as never,
      currentDateString: '2026-03-13',
      bedId: 'B-12',
    };
    try {
      const view = render(<ClinicalDocumentsModal {...props} isOpen={false} />);
      view.rerender(<ClinicalDocumentsModal {...props} isOpen={true} />);
      view.rerender(<ClinicalDocumentsModal {...props} isOpen={true} />);
      expect(invalidate).not.toHaveBeenCalled();

      view.rerender(<ClinicalDocumentsModal {...props} isOpen={false} />);
      view.rerender(<ClinicalDocumentsModal {...props} isOpen={false} />);
      expect(invalidate).toHaveBeenCalledExactlyOnceWith({
        queryKey: ['clinicalDocuments', 'presenceByBed'],
      });
    } finally {
      invalidate.mockRestore();
    }
  });
});
