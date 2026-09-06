import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LaboratoryQuickAction } from '@/features/laboratory/components/LaboratoryQuickAction';
import { checkSyslabConnection } from '@/services/laboratory/syslabService';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

vi.mock('@/services/laboratory/syslabService', () => ({
  checkSyslabConnection: vi.fn(),
}));

vi.mock('@/features/laboratory/components/LabResultsViewerModal', () => ({
  LabResultsViewerModal: (props: { isOpen: boolean; onClose: () => void }) => {
    modalRender(props);
    return props.isOpen ? <button onClick={props.onClose}>Lab modal</button> : null;
  },
}));

const modalRender = vi.hoisted(() => vi.fn());

const patients: MedicalIndicationsPatientOption[] = [
  {
    bedId: 'R1',
    label: 'R1 - Paciente',
    patientName: 'Paciente Syslab',
    rut: '12.345.678-9',
    diagnosis: 'Dx',
    age: '50',
    birthDate: '1976-01-01',
    allergies: '',
    admissionDate: '2026-04-30',
    daysOfStay: '1',
    treatingDoctor: '',
  },
];

describe('LaboratoryQuickAction', () => {
  it('does not mount the viewer until requested and unmounts it on close', async () => {
    vi.mocked(checkSyslabConnection).mockReturnValue(new Promise(() => {}) as never);
    modalRender.mockClear();
    render(<LaboratoryQuickAction patients={patients} />);
    expect(modalRender).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^laboratorio$/i }));
    fireEvent.click(await screen.findByText('Lab modal'));
    expect(screen.queryByText('Lab modal')).not.toBeInTheDocument();
    expect(modalRender.mock.calls.every(([props]) => props.isOpen)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^laboratorio$/i }));
    expect(await screen.findByText('Lab modal')).toBeInTheDocument();
  });
  it('uses the stable DateStrip quick-action slot dimensions from the first render', () => {
    vi.mocked(checkSyslabConnection).mockReturnValue(new Promise(() => {}) as never);

    render(<LaboratoryQuickAction patients={patients} />);

    const button = screen.getByRole('button', { name: /lab/i });
    expect(button).toHaveClass('h-[30px]');
    expect(button).toHaveClass('min-w-[76px]');
    expect(button).toHaveClass('py-0');
    expect(button).toHaveClass('text-[10px]');
  });

  it('keeps the Syslab viewer reachable when the connection check is unavailable', async () => {
    vi.mocked(checkSyslabConnection).mockResolvedValue({
      available: false,
      message: 'Failed to fetch',
    });

    render(<LaboratoryQuickAction patients={patients} />);

    const button = screen.getByRole('button', { name: /lab/i });
    expect(button).toBeEnabled();

    await waitFor(() => {
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute('title', 'Syslab no disponible: Failed to fetch');
      expect(button).toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-700');
    });

    fireEvent.click(button);
    expect(await screen.findByText('Lab modal')).toBeInTheDocument();
  });

  it('disables the action only when there are no patients with RUT', async () => {
    vi.mocked(checkSyslabConnection).mockResolvedValue({
      available: true,
      message: 'Conectado',
    });

    render(<LaboratoryQuickAction patients={[]} />);

    expect(screen.getByRole('button', { name: /lab/i })).toBeDisabled();
  });

  it('enables the Syslab button when the health check is available', async () => {
    vi.mocked(checkSyslabConnection).mockResolvedValue({
      available: true,
      message: 'Conectado',
    });

    render(<LaboratoryQuickAction patients={patients} />);

    const button = screen.getByRole('button', { name: /lab/i });
    await waitFor(() => {
      expect(button).toBeEnabled();
      expect(button).toHaveClass('border-slate-200', 'bg-slate-50', 'text-slate-600');
    });
  });
});
