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

    // A tab list: arrows move between patients, and each tab names the form it shows.
    expect(first).toHaveAttribute('tabindex', '0');
    expect(added).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(added).toHaveAttribute('aria-selected', 'true');
    expect(added).toHaveFocus();
    const panel = screen.getByRole('tabpanel', { name: /R2/ });
    expect(added).toHaveAttribute('aria-controls', panel.id);
    fireEvent.keyDown(added, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('prints all the typed OTROS and MEDICO TRATANTE, wrapping instead of cutting', () => {
    const { rerender } = render(
      <ExamRequestModal isOpen={true} onClose={vi.fn()} patient={mockPatient} />
    );
    const form = screen.getByTestId('exam-request-form');
    const otros =
      'Perfil lipídico, ferritina, vitamina B12, procalcitonina, hemoglobina glicosilada, cortisol, acido folico';
    const medico = 'Dra. Sintética Pérez de la Fuente Riroroko, Medicina Interna, turno de noche';

    fireEvent.change(within(form).getByRole('textbox', { name: 'OTROS' }), {
      target: { value: otros },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: 'MEDICO TRATANTE' }), {
      target: { value: medico },
    });

    // Paper gets a plain copy of every character, which wraps onto the next ruled line; the
    // fields, whose box would cut what does not fit, stay off the page.
    const printedOtros = within(form).getByTestId('exam-request-print-otros');
    const printedMedico = within(form).getByTestId('exam-request-print-medicoTratante');
    expect(printedOtros).toHaveTextContent(otros, { normalizeWhitespace: false });
    expect(printedMedico).toHaveTextContent(medico, { normalizeWhitespace: false });
    for (const printed of [printedOtros, printedMedico]) {
      expect(printed).toHaveClass('hidden', 'print:block', 'whitespace-pre-wrap', 'break-words');
    }
    within(form)
      .getAllByRole('textbox')
      .forEach(input => expect(input).toHaveClass('print:hidden'));
    // FIRMA stays a blank line for handwriting.
    expect(within(form).getAllByRole('textbox')).toHaveLength(2);

    // Nothing is kept once the dialog closes: the next opening starts blank.
    rerender(<ExamRequestModal isOpen={false} onClose={vi.fn()} patient={mockPatient} />);
    rerender(<ExamRequestModal isOpen={true} onClose={vi.fn()} patient={mockPatient} />);
    const reopened = screen.getByTestId('exam-request-form');
    within(reopened)
      .getAllByRole('textbox')
      .forEach(input => expect(input).toHaveValue(''));
    expect(within(reopened).getByTestId('exam-request-print-otros')).toBeEmptyDOMElement();
  });

  it('starts a blank request when another patient takes the bed while it is open', () => {
    const first = { ...mockPatient, clinicalEpisodeId: 'episode-a' };
    const { rerender } = render(
      <ExamRequestModal isOpen={true} onClose={vi.fn()} patient={first} />
    );
    fireEvent.click(screen.getByText('ELECTROLITOS PLASMATICOS'));
    fireEvent.change(screen.getByRole('textbox', { name: 'OTROS' }), {
      target: { value: 'Ferritina' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'MEDICO TRATANTE' }), {
      target: { value: 'Dra. Sintética' },
    });

    // A sync refresh of the same patient and episode keeps what was typed.
    rerender(
      <ExamRequestModal
        isOpen={true}
        onClose={vi.fn()}
        patient={{ ...first, pathology: 'Neumonia grave' }}
      />
    );
    expect(screen.getByDisplayValue('Ferritina')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();

    rerender(
      <ExamRequestModal
        isOpen={true}
        onClose={vi.fn()}
        patient={{
          ...mockPatient,
          patientName: 'Otro Sintetico',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'episode-b',
        }}
      />
    );
    const form = screen.getByTestId('exam-request-form');
    expect(within(form).getByText(/Otro Sintetico/i)).toBeInTheDocument();
    expect(within(form).queryByText('X')).not.toBeInTheDocument();
    within(form)
      .getAllByRole('textbox')
      .forEach(input => expect(input).toHaveValue(''));
  });

  it('never carries a request between patients that no episode or document identifies', () => {
    // Two provisional newborns: same name and admission day, no RUT and no episode yet.
    const newborn = { ...mockPatient, rut: '', patientName: 'RN de Madre Sintética' };
    const first = { ...newborn, admissionTime: '08:10' };
    const { rerender } = render(
      <ExamRequestModal isOpen={true} onClose={vi.fn()} patient={first} />
    );
    fireEvent.click(screen.getByText('ELECTROLITOS PLASMATICOS'));
    fireEvent.change(screen.getByRole('textbox', { name: 'OTROS' }), {
      target: { value: 'Bilirrubina' },
    });

    // Re-rendering the same record keeps what was typed.
    rerender(<ExamRequestModal isOpen={true} onClose={vi.fn()} patient={first} />);
    expect(screen.getByDisplayValue('Bilirrubina')).toBeInTheDocument();

    rerender(
      <ExamRequestModal
        isOpen={true}
        onClose={vi.fn()}
        patient={{ ...newborn, admissionTime: '21:40' }}
      />
    );
    const form = screen.getByTestId('exam-request-form');
    expect(within(form).queryByText('X')).not.toBeInTheDocument();
    within(form)
      .getAllByRole('textbox')
      .forEach(input => expect(input).toHaveValue(''));
  });

  it('updates the selected exam count when a visible exam is toggled', async () => {
    render(<ExamRequestModal isOpen={true} onClose={vi.fn()} patient={mockPatient} />);

    fireEvent.click(screen.getByText('ELECTROLITOS PLASMATICOS'));

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
    });
  });
});
