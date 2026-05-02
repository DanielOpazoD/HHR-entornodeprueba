import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { HandoffDevicesCell } from '@/features/handoff/components/HandoffDevicesCell';
import { HandoffPatientCell } from '@/features/handoff/components/HandoffPatientCell';

vi.mock('@/application/patient-flow/clinicalEpisode', () => ({
  buildClinicalEpisodeKey: vi.fn(() => 'episode-key-1'),
}));

vi.mock('@/features/wound-care/public', () => ({
  WoundCareModal: ({
    episodeContext,
    patientName,
  }: {
    episodeContext: { episodeKey: string };
    patientName: string;
  }) => (
    <div data-testid="wound-care-modal">
      {patientName}:{episodeContext.episodeKey}
    </div>
  ),
  WoundCareErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWoundCarePhotoCount: vi.fn(() => 2),
}));

vi.mock('@/components/device-selector/DeviceDateConfigModal', () => ({
  calculateDeviceDays: vi.fn(() => 4),
}));

describe('HandoffRow cell components', () => {
  it('opens wound care modal with the resolved episode context for non-subrows', () => {
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-04-19',
    });

    render(
      <table>
        <tbody>
          <tr>
            <HandoffPatientCell patient={patient} />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByRole('button', { name: /registro clínico audiovisual/i }));

    expect(screen.getByTestId('wound-care-modal')).toHaveTextContent('Paciente Demo:episode-key-1');
  });

  it('shows device badges with computed installation days', () => {
    const patient = DataFactory.createMockPatient('R1', {
      devices: ['CVC'],
      deviceDetails: {
        CVC: {
          installationDate: '2026-04-15',
        },
      },
    });

    render(
      <table>
        <tbody>
          <tr>
            <HandoffDevicesCell patient={patient} reportDate="2026-04-19" />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('CVC')).toBeInTheDocument();
    expect(screen.getByText('(4d)')).toBeInTheDocument();
  });
});
