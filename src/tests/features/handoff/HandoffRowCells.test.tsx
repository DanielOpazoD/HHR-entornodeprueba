import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { HandoffDevicesCell } from '@/features/handoff/components/HandoffDevicesCell';
import { HandoffPatientCell } from '@/features/handoff/components/HandoffPatientCell';
import { useWoundCarePhotoCount } from '@/features/wound-care/public';

vi.mock('@/application/patient-flow/clinicalEpisode', () => ({
  buildClinicalEpisodeKey: vi.fn(() => 'episode-key-1'),
}));

vi.mock('@/features/wound-care/public', () => ({
  WoundCareModal: ({
    episodeContext,
    patientName,
    onClose,
  }: {
    episodeContext: { episodeKey: string };
    patientName: string;
    onClose: () => void;
  }) => (
    <div data-testid="wound-care-modal">
      {patientName}:{episodeContext.episodeKey}
      <button type="button" onClick={onClose}>
        cerrar
      </button>
    </div>
  ),
  WoundCareErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWoundCarePhotoCount: vi.fn(() => ({ status: 'ready', count: 2 })),
}));

vi.mock('@/components/device-selector/DeviceDateConfigModal', () => ({
  calculateDeviceDays: vi.fn(() => 4),
}));

describe('HandoffRow cell components', () => {
  beforeEach(() => {
    vi.mocked(useWoundCarePhotoCount).mockReturnValue({ status: 'ready', count: 2 });
  });

  const countStates: Array<{
    state: ReturnType<typeof useWoundCarePhotoCount>;
    label: string;
    busy: boolean;
  }> = [
    { state: { status: 'loading', previousCount: null }, label: 'consultando fotos', busy: true },
    {
      state: { status: 'unavailable', previousCount: null },
      label: 'recuento no disponible',
      busy: false,
    },
    { state: { status: 'ready', count: 0 }, label: '(0 fotos)', busy: false },
    {
      state: { status: 'loading', previousCount: 2 },
      label: 'consultando fotos; último recuento: 2 fotos',
      busy: true,
    },
    {
      state: { status: 'unavailable', previousCount: 2 },
      label: 'recuento no disponible; último recuento: 2 fotos',
      busy: false,
    },
  ];
  it.each(countStates)(
    'presents $label and keeps the gallery available',
    ({ state, label, busy }) => {
      vi.mocked(useWoundCarePhotoCount).mockReturnValue(state);
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
      const button = screen.getByRole('button', {
        name: `Registro clínico audiovisual${label.startsWith('(') ? ' ' : ': '}${label}`,
      });
      expect(button).toHaveAttribute('aria-busy', String(busy));
      if (state.status !== 'ready') expect(button).not.toHaveAccessibleName(/\(0 fotos\)/);
      fireEvent.click(button);
      expect(screen.getByTestId('wound-care-modal')).toBeInTheDocument();
    }
  );

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

  it('asks the photo badge to refresh when the wound-care modal closes', async () => {
    const { useWoundCarePhotoCount } = await import('@/features/wound-care/public');
    vi.mocked(useWoundCarePhotoCount).mockClear();
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
    expect(vi.mocked(useWoundCarePhotoCount)).toHaveBeenLastCalledWith('episode-key-1', 0);

    fireEvent.click(screen.getByTitle(/Registro clínico audiovisual/));
    fireEvent.click(screen.getByRole('button', { name: 'cerrar' }));

    expect(screen.queryByTestId('wound-care-modal')).not.toBeInTheDocument();
    expect(vi.mocked(useWoundCarePhotoCount)).toHaveBeenLastCalledWith('episode-key-1', 1);
  });
});
