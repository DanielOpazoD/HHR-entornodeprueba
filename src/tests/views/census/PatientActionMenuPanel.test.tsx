import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';

import { PatientActionMenuPanel } from '@/features/census/components/patient-row/PatientActionMenuPanel';

describe('PatientActionMenuPanel', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <PatientActionMenuPanel
        isOpen={false}
        align="top"
        viewState={{
          showDemographicsAction: true,
          showMenuTrigger: true,
          showHistoryAction: true,
          showClinicalSection: true,
          showExamRequestAction: true,
        }}
        utilityActions={[]}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onViewHistory={vi.fn()}
        onViewExamRequest={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders history/clinical actions and dispatches callbacks', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    const onViewHistory = vi.fn();
    const onViewExamRequest = vi.fn();

    render(
      <PatientActionMenuPanel
        isOpen={true}
        align="bottom"
        viewState={{
          showDemographicsAction: true,
          showMenuTrigger: true,
          showHistoryAction: true,
          showClinicalSection: true,
          showExamRequestAction: true,
        }}
        utilityActions={[
          {
            action: 'clear',
            label: 'Limpiar',
            title: 'Borrar datos',
            icon: Trash2,
            iconClassName: 'x',
            visibleWhenBlocked: true,
          },
        ]}
        onClose={onClose}
        onAction={onAction}
        onViewHistory={onViewHistory}
        onViewExamRequest={onViewExamRequest}
      />
    );

    fireEvent.click(screen.getByText('Ver Historial'));
    expect(onViewHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Limpiar'));
    expect(onAction).toHaveBeenCalledWith('clear');

    fireEvent.click(screen.getByText('Solicitud Exámenes'));
    expect(onViewExamRequest).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector('.fixed.inset-0.z-40');
    if (!overlay) {
      throw new Error('Overlay not found');
    }
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
