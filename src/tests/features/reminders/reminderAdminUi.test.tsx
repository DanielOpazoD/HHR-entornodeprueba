import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseReminderAdmin = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ role: 'admin' })),
}));

vi.mock('@/components/shared/BaseModal', () => ({
  BaseModal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <section data-testid="base-modal">
        <h2>{title}</h2>
        {children}
      </section>
    ) : null,
}));

vi.mock('@/components/reminders/ReminderCard', () => ({
  ReminderCard: ({ reminder }: { reminder: { title: string } }) => <div>{reminder.title}</div>,
}));

vi.mock('@/features/reminders/hooks/useReminderAdmin', () => ({
  useReminderAdmin: () => mockUseReminderAdmin(),
}));

import { useAuth } from '@/context/AuthContext';
import { ReminderAdminView } from '@/features/reminders/public';
import { ReminderFormModal } from '@/features/reminders/components/admin/ReminderFormModal';
import { ReminderReadStatusTable } from '@/features/reminders/components/admin/ReminderReadStatusTable';
import type { Reminder } from '@/types/reminders';

describe('reminder admin ui', () => {
  const buildAdminState = () => ({
    reminders: [],
    loading: false,
    loadError: null,
    retryLoadReminders: vi.fn(),
    processing: false,
    isFormOpen: false,
    formReminder: null,
    openCreateForm: vi.fn(),
    openEditForm: vi.fn(),
    closeForm: vi.fn(),
    saveReminder: vi.fn(),
    deleteReminder: vi.fn(),
    receiptsReminder: null,
    readReceipts: [],
    receiptsLoading: false,
    receiptsError: null,
    openReadStatus: vi.fn(),
    retryReadStatus: vi.fn(),
    closeReadStatus: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ role: 'admin' } as never);
    mockUseReminderAdmin.mockReturnValue(buildAdminState());
  });

  it('shows restricted access copy for non-admin roles', () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'nurse_hospital' } as never);

    render(<ReminderAdminView />);

    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
    expect(screen.queryByText('Nuevo aviso')).not.toBeInTheDocument();
  });

  it('renders empty admin state and delegates create action', () => {
    const openCreateForm = vi.fn();
    mockUseReminderAdmin.mockReturnValue({
      ...buildAdminState(),
      openCreateForm,
    });

    render(<ReminderAdminView />);

    expect(screen.getByText(/No hay avisos creados/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nuevo aviso'));
    expect(openCreateForm).toHaveBeenCalledTimes(1);
  });

  it('renders reminder rows, load errors and delegates row actions', () => {
    const openEditForm = vi.fn();
    const openReadStatus = vi.fn();
    const deleteReminder = vi.fn();
    const reminder = {
      id: 'rem-2',
      title: 'Control de stock',
      message: 'Validar insumos del turno.',
      type: 'warning',
      targetRoles: ['nurse_hospital'],
      targetShifts: ['day'],
      startDate: '2026-03-22',
      endDate: '2026-03-23',
      priority: 2,
      isActive: true,
      createdBy: 'admin',
      createdByName: 'Admin',
      createdAt: '2026-03-22T10:00:00.000Z',
      updatedAt: '2026-03-22T10:00:00.000Z',
    };

    mockUseReminderAdmin.mockReturnValue({
      ...buildAdminState(),
      reminders: [reminder],
      loadError: 'No fue posible cargar avisos.',
      openEditForm,
      openReadStatus,
      deleteReminder,
    });

    render(<ReminderAdminView />);

    expect(screen.getByText('No fue posible cargar avisos.')).toBeInTheDocument();
    expect(screen.getByText('Control de stock')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lecturas'));
    fireEvent.click(screen.getByText('Editar'));
    fireEvent.click(screen.getByText('Eliminar'));

    expect(openReadStatus).toHaveBeenCalledWith(reminder);
    expect(openEditForm).toHaveBeenCalledWith(reminder);
    expect(deleteReminder).toHaveBeenCalledWith(reminder);
  });

  it('submits reminder draft changes and image removal intent', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <ReminderFormModal
        isOpen
        reminder={{
          id: 'rem-1',
          title: 'Aviso original',
          message: 'Mensaje',
          type: 'info',
          targetRoles: ['nurse_hospital'],
          targetShifts: ['day'],
          startDate: '2026-03-22',
          endDate: '2026-03-23',
          priority: 2,
          isActive: true,
          createdBy: 'admin',
          createdByName: 'Admin',
          createdAt: '2026-03-22T10:00:00.000Z',
          updatedAt: '2026-03-22T10:00:00.000Z',
          imageUrl: 'https://example.com/image.png',
          imagePath: 'reminders/rem-1.png',
        }}
        processing={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Aviso original'), {
      target: { value: 'Aviso actualizado' },
    });
    fireEvent.click(screen.getByText('Invitado lectura general'));
    fireEvent.click(screen.getByText('Turno Noche'));
    fireEvent.click(screen.getByLabelText('Quitar imagen actual'));
    fireEvent.submit(screen.getByRole('button', { name: /guardar cambios/i }).closest('form')!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          removeImage: true,
          imageFile: null,
          draft: expect.objectContaining({
            title: 'Aviso actualizado',
            targetRoles: expect.arrayContaining(['nurse_hospital', 'viewer']),
            targetShifts: expect.arrayContaining(['day', 'night']),
          }),
        })
      );
    });
  });

  it('supports create mode field changes, file selection and cancel', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <ReminderFormModal
        isOpen
        reminder={null}
        processing={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );

    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], {
      target: { value: 'Nuevo aviso' },
    });
    fireEvent.change(textboxes[1], {
      target: { value: 'Mensaje actualizado' },
    });
    fireEvent.change(screen.getByDisplayValue('Informativo'), {
      target: { value: 'urgent' },
    });
    fireEvent.change(screen.getByDisplayValue('Alta'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)[0], {
      target: { value: '2026-03-24' },
    });
    fireEvent.change(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)[1], {
      target: { value: '2026-03-25' },
    });
    fireEvent.click(screen.getByText('Turno Día'));
    fireEvent.click(screen.getByLabelText('Aviso activo'));

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['binary'], 'aviso.png', { type: 'image/png' })],
      },
    });

    expect(screen.getByText('aviso.png')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders read receipts and loading states', () => {
    const reminder: Reminder = {
      id: 'rem-1',
      title: 'Aviso',
      message: 'Mensaje',
      type: 'info',
      targetRoles: ['nurse_hospital'],
      targetShifts: ['day'],
      startDate: '2026-03-22',
      endDate: '2026-03-23',
      priority: 2,
      isActive: true,
      createdBy: 'admin',
      createdByName: 'Admin',
      createdAt: '2026-03-22T10:00:00.000Z',
      updatedAt: '2026-03-22T10:00:00.000Z',
    };

    const { rerender } = render(
      <ReminderReadStatusTable reminder={reminder} receipts={[]} loading onClose={vi.fn()} />
    );
    expect(screen.getByText('Cargando...')).toBeInTheDocument();

    rerender(
      <ReminderReadStatusTable
        reminder={reminder}
        receipts={[
          {
            userId: 'user-1',
            userName: 'Enfermera Test',
            shift: 'day',
            dateKey: '2026-03-22',
            readAt: '2026-03-22T10:15:00.000Z',
          },
        ]}
        loading={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Enfermera Test')).toBeInTheDocument();
    expect(screen.getByText('Dia')).toBeInTheDocument();
  });

  it('shows an error alert with retry instead of empty read receipts when loading fails', () => {
    const onRetry = vi.fn();
    const reminder: Reminder = {
      id: 'rem-err',
      title: 'Aviso con fallo',
      message: 'Mensaje',
      type: 'info',
      targetRoles: ['nurse_hospital'],
      targetShifts: ['day'],
      startDate: '2026-03-22',
      endDate: '2026-03-23',
      priority: 2,
      isActive: true,
      createdBy: 'admin',
      createdByName: 'Admin',
      createdAt: '2026-03-22T10:00:00.000Z',
      updatedAt: '2026-03-22T10:00:00.000Z',
    };

    render(
      <ReminderReadStatusTable
        reminder={reminder}
        receipts={[]}
        loading={false}
        error="No fue posible cargar el detalle de lecturas del aviso."
        onRetry={onRetry}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No fue posible cargar el detalle de lecturas del aviso.'
    );
    expect(
      screen.queryByText(/Todavia no hay lecturas registradas para este aviso/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show the empty reminders message when the feed failed to load and wires retry', () => {
    const retryLoadReminders = vi.fn();
    mockUseReminderAdmin.mockReturnValue({
      ...buildAdminState(),
      reminders: [],
      loadError: 'No fue posible suscribirse a los avisos.',
      retryLoadReminders,
    });

    render(<ReminderAdminView />);

    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible suscribirse a los avisos.');
    expect(screen.queryByText(/No hay avisos creados/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retryLoadReminders).toHaveBeenCalledTimes(1);
  });
});
