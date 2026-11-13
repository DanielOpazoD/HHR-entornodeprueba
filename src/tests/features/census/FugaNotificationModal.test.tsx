import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { FugaNotificationModal } from '@/features/census/components/FugaNotificationModal';
import type { DischargeData } from '@/types/domain/movements';

const sendFugaNotificationMock = vi.fn();
const useAuthStateMock = vi.fn();
const confirmMock = vi.fn();

vi.mock('@/services/integrations/fugaNotificationService', () => ({
  sendFugaNotification: (...args: unknown[]) => sendFugaNotificationMock(...args),
}));

vi.mock('@/hooks/useAuthState', () => ({
  useAuthState: () => useAuthStateMock(),
}));

vi.mock('@/context/UIContext', () => ({
  useUI: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
  }),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStaff: () => ({
    nursesNightShift: ['Enf Uno', 'Enf Dos'],
  }),
}));

describe('FugaNotificationModal', () => {
  const baseDischarge = {
    id: '1',
    patientName: 'Paciente Test',
    rut: '11.111.111-1',
    diagnosis: 'Diagnóstico Test',
    bedName: 'Cama 1',
    bedId: 'R1',
    bedType: 'MEDIA',
    specialty: 'Cirugía',
    dischargeType: 'Fuga',
    movementDate: '2026-03-31',
    time: '14:30',
    status: 'Vivo',
  } satisfies DischargeData;

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStateMock.mockReturnValue({ role: 'nurse_hospital' });
    sendFugaNotificationMock.mockResolvedValue({ success: true, message: 'ok', gmailId: '1' });
    confirmMock.mockResolvedValue(true);
  });

  it('valida correo inválido en destinatarios manuales', async () => {
    render(
      <FugaNotificationModal
        isOpen
        onClose={vi.fn()}
        dischargeItem={baseDischarge}
        recordDate="2026-03-31"
      />
    );

    const automaticMessageField = screen.getByRole('textbox', {
      name: /mensaje automático \(editable\)/i,
    }) as HTMLTextAreaElement;
    expect(automaticMessageField.value).toContain('(RUT: 11.111.111-1)');
    expect(automaticMessageField.value).toContain('Fecha de egreso: 31-03-2026');

    fireEvent.change(screen.getByPlaceholderText(/ejemplo1@hospital.cl/i), {
      target: { value: 'correo-invalido' },
    });

    fireEvent.click(screen.getByRole('button', { name: /enviar notificación/i }));

    expect(await screen.findByText(/no son válidos/i)).toBeInTheDocument();
    expect(sendFugaNotificationMock).not.toHaveBeenCalled();
  });

  it('permite editar mensaje automático y lo envía como obligatorio', async () => {
    render(
      <FugaNotificationModal
        isOpen
        onClose={vi.fn()}
        dischargeItem={baseDischarge}
        recordDate="2026-03-31"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/ejemplo1@hospital.cl/i), {
      target: { value: 'destino@hospital.cl' },
    });

    const automaticMessageField = screen.getByRole('textbox', {
      name: /mensaje automático \(editable\)/i,
    });
    fireEvent.change(automaticMessageField, {
      target: { value: 'Mensaje ajustado por enfermería' },
    });

    fireEvent.click(screen.getByRole('button', { name: /enviar notificación/i }));

    await waitFor(() => {
      expect(sendFugaNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          automaticMessage: 'Mensaje ajustado por enfermería',
          nursesSignature: 'Enf Uno / Enf Dos',
          note: undefined,
          recipients: ['destino@hospital.cl'],
        })
      );
    });
  });

  it('muestra modo automático para psiquiatría sin requerir destinatarios manuales', async () => {
    render(
      <FugaNotificationModal
        isOpen
        onClose={vi.fn()}
        dischargeItem={{
          ...baseDischarge,
          specialty: 'Psiquiatría',
        }}
        recordDate="2026-03-31"
      />
    );

    expect(screen.getByText(/destinatarios automáticos psiquiatría/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ejemplo1@hospital.cl/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /enviar notificación/i }));

    await waitFor(() => {
      expect(sendFugaNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          recipients: undefined,
          specialty: 'Psiquiatría',
        })
      );
    });
  });

  it('admin en modo prueba exige correo válido y envía solo al testRecipient', async () => {
    useAuthStateMock.mockReturnValue({ role: 'admin' });

    render(
      <FugaNotificationModal
        isOpen
        onClose={vi.fn()}
        dischargeItem={baseDischarge}
        recordDate="2026-03-31"
      />
    );

    fireEvent.click(screen.getByLabelText(/modo prueba \(admin\)/i));
    expect(screen.getByText(/estás enviando en modo prueba/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/correo.prueba@hospital.cl/i), {
      target: { value: 'correo-invalido' },
    });

    fireEvent.click(screen.getByRole('button', { name: /enviar notificación/i }));

    expect(await screen.findByText(/no son válidos/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/correo.prueba@hospital.cl/i), {
      target: { value: 'test@hospital.cl' },
    });

    fireEvent.click(screen.getByRole('button', { name: /enviar notificación/i }));

    await waitFor(() => {
      expect(sendFugaNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          testMode: true,
          testRecipient: 'test@hospital.cl',
          recipients: ['test@hospital.cl'],
        })
      );
    });
  });
});
