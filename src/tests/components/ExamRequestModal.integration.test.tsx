import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { ExamRequestModal } from '@/components/modals/ExamRequestModal';
import type { PatientData } from '@/types/domain/patient';

const printMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/controllers/examRequestPrintController', () => ({
  runExamRequestPrint: printMock,
}));

vi.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: () => {},
  default: () => {},
}));

const mockPatient: PatientData = {
  bedId: 'bed-1',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Integracion',
  rut: '11.111.111-1',
  age: '45',
  pathology: 'Neumonia',
  specialty: 'Medicina' as PatientData['specialty'],
  status: 'Hospitalizado' as PatientData['status'],
  admissionDate: '2026-04-04',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  insurance: 'Fonasa',
};

describe('ExamRequestModal integration', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the exam request modal without duplicated green-tube exams', () => {
    render(<ExamRequestModal isOpen={true} onClose={vi.fn()} patient={mockPatient} />);

    expect(screen.getByText('Solicitud de Laboratorio')).toBeInTheDocument();
    expect(screen.getAllByText('ELECTROLITOS PLASMATICOS')).toHaveLength(1);
    expect(screen.getAllByText('LACTATO')).toHaveLength(1);
  });

  it('prints the census date in the exam request form', () => {
    render(
      <ExamRequestModal
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        recordDate="2026-04-30"
      />
    );

    expect(screen.getByText('30-04-2026')).toBeInTheDocument();
  });

  it('prepares orders for several census patients and prints them as one document', () => {
    const second: PatientData = {
      ...mockPatient,
      patientName: 'Segundo Sintetico',
      insurance: 'Isapre',
    };
    render(
      <ExamRequestModal
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        candidates={[
          { key: 'R1', label: 'R1', patient: mockPatient },
          { key: 'R2', label: 'R2', patient: second },
        ]}
        patientKey="R1"
      />
    );
    const tabs = screen.getByRole('tablist', { name: 'Pacientes de la solicitud' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Imprimir$/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pacientes/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /R2/ }));
    const [first, added] = within(tabs).getAllByRole('tab');
    expect(added).toHaveAttribute('aria-selected', 'true');
    expect(added).toHaveTextContent('Segundo Sintetico');

    // Each patient keeps its own marks: one exam on the second order only.
    fireEvent.click(screen.getAllByText('ELECTROLITOS PLASMATICOS')[1]);
    expect(added).toHaveTextContent('1');
    expect(first).toHaveTextContent('0');

    // Both forms are in the printed document, one page each; only the active one shows.
    const forms = screen.getAllByTestId('exam-request-form');
    expect(forms).toHaveLength(2);
    expect(forms[0]).toHaveClass('hidden', 'print:block');
    expect(forms[0]).toHaveStyle({ breakAfter: 'page' });
    expect(forms[1]).not.toHaveClass('hidden');
    fireEvent.click(screen.getByRole('button', { name: /Imprimir 2 órdenes/ }));
    expect(printMock).toHaveBeenCalledTimes(1);

    fireEvent.click(first);
    expect(screen.getAllByTestId('exam-request-form')[0]).not.toHaveClass('hidden');
  });

  it('updates the selected exam count when a visible exam is toggled', async () => {
    render(<ExamRequestModal isOpen={true} onClose={vi.fn()} patient={mockPatient} />);

    fireEvent.click(screen.getByText('ELECTROLITOS PLASMATICOS'));

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
    });
  });
});
