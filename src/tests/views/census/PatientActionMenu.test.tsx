import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PatientActionMenu } from '@/features/census/components/patient-row/PatientActionMenu';

describe('PatientActionMenu', () => {
  it('shows an anchored loading state while the actions menu code loads', () => {
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <PatientActionMenu
                isBlocked={false}
                onAction={vi.fn()}
                onViewDemographics={vi.fn()}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Acciones'));

    const loadingState = screen.getByRole('status');
    expect(loadingState).toHaveTextContent('Cargando acciones…');
    expect(loadingState.closest('[data-testid="patient-row-menu-portal"]')).toHaveProperty(
      'parentElement',
      document.body
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the demographics icon visible for specialist access without opening demographics', () => {
    const onViewDemographics = vi.fn();

    render(
      <PatientActionMenu
        isBlocked={false}
        readOnly={true}
        accessProfile="specialist"
        hasClinicalDocument={true}
        isNewAdmission={false}
        onAction={vi.fn()}
        onViewDemographics={onViewDemographics}
        onViewClinicalDocuments={vi.fn()}
        onViewExamRequest={vi.fn()}
        onViewImagingRequest={vi.fn()}
      />
    );

    const demographicsButton = screen.getByTitle('Datos del Paciente');
    expect(demographicsButton).toBeInTheDocument();

    fireEvent.click(demographicsButton);
    expect(onViewDemographics).not.toHaveBeenCalled();
  });

  it('does not render the quick actions trigger when the row has no patient identity yet', () => {
    render(
      <PatientActionMenu
        isBlocked={false}
        readOnly={false}
        hasPatientIdentity={false}
        hasClinicalDocument={false}
        isNewAdmission={false}
        onAction={vi.fn()}
        onViewDemographics={vi.fn()}
      />
    );

    expect(screen.queryByTitle('Acciones')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /acciones clínicas rápidas/i })
    ).not.toBeInTheDocument();
  });
});
