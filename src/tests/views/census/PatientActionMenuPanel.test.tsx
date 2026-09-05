import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';

import { PatientActionMenuPanel } from '@/features/census/components/patient-row/PatientActionMenuPanel';

describe('PatientActionMenuPanel', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <PatientActionMenuPanel
        anchorRef={{ current: null }}
        isOpen={false}
        binding={{
          align: 'top',
          isBlocked: false,
          readOnly: false,
          showCmaAction: true,
          indicators: {
            hasClinicalDocument: false,
            isNewAdmission: false,
          },
          availability: {
            showDemographicsAction: true,
            showMenuTrigger: true,
            showHistoryAction: true,
            showUtilityActions: true,
            showClinicalSection: true,
            showBuiltInClinicalActions: true,
            showClinicalDocumentsAction: true,
            showExamRequestAction: true,
            showImagingRequestAction: true,
            showMedicalIndicationsAction: false,
          },
        }}
        utilityActions={[]}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onViewHistory={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders history, utility actions and clinical management actions', () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    const onViewHistory = vi.fn();

    render(
      <PatientActionMenuPanel
        anchorRef={{ current: null }}
        isOpen={true}
        binding={{
          align: 'bottom',
          isBlocked: false,
          readOnly: false,
          showCmaAction: true,
          indicators: {
            hasClinicalDocument: true,
            isNewAdmission: true,
          },
          availability: {
            showDemographicsAction: true,
            showMenuTrigger: true,
            showHistoryAction: true,
            showUtilityActions: true,
            showClinicalSection: true,
            showBuiltInClinicalActions: true,
            showClinicalDocumentsAction: true,
            showExamRequestAction: true,
            showImagingRequestAction: true,
            showMedicalIndicationsAction: false,
          },
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
      />
    );

    fireEvent.click(screen.getByText('Ver Historial'));
    expect(onViewHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Limpiar'));
    expect(onAction).toHaveBeenCalledWith('clear');

    fireEvent.click(screen.getByText('Dar de Alta'));
    expect(onAction).toHaveBeenCalledWith('discharge');

    fireEvent.click(screen.getByText('Trasladar'));
    expect(onAction).toHaveBeenCalledWith('transfer');

    fireEvent.click(screen.getByText('Egreso CMA'));
    expect(onAction).toHaveBeenCalledWith('cma');
    expect(screen.queryByText('Documentos Clínicos')).not.toBeInTheDocument();
    expect(screen.queryByText('Solicitud Exámenes')).not.toBeInTheDocument();
    expect(screen.queryByText('Solicitud de Imágenes')).not.toBeInTheDocument();

    expect(screen.getByTestId('patient-row-menu-portal').parentElement).toBe(document.body);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns null when the classic panel has no remaining actions to show', () => {
    const { container } = render(
      <PatientActionMenuPanel
        anchorRef={{ current: null }}
        isOpen={true}
        binding={{
          align: 'bottom',
          isBlocked: false,
          readOnly: true,
          showCmaAction: false,
          accessProfile: 'specialist',
          indicators: {
            hasClinicalDocument: true,
            isNewAdmission: false,
          },
          availability: {
            showDemographicsAction: false,
            showMenuTrigger: true,
            showHistoryAction: false,
            showUtilityActions: false,
            showClinicalSection: true,
            showBuiltInClinicalActions: false,
            showClinicalDocumentsAction: true,
            showExamRequestAction: true,
            showImagingRequestAction: true,
            showMedicalIndicationsAction: false,
          },
        }}
        utilityActions={[]}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onViewHistory={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
