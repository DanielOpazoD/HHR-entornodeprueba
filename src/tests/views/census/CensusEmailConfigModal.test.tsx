import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CensusEmailConfigModal } from '@/features/census/components/CensusEmailConfigModal';

const buildProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  recipients: ['a@mail.com'],
  onRecipientsChange: vi.fn(),
  recipientLists: [
    {
      id: 'census-default',
      name: 'Lista principal',
      description: null,
      recipients: ['a@mail.com'],
      scope: 'global' as const,
      updatedAt: '2026-03-02T10:00:00.000Z',
      updatedByUid: null,
      updatedByEmail: null,
    },
  ],
  activeRecipientListId: 'census-default',
  onActiveRecipientListChange: vi.fn(),
  onCreateRecipientList: vi.fn().mockResolvedValue(undefined),
  onRenameRecipientList: vi.fn().mockResolvedValue(undefined),
  onDeleteRecipientList: vi.fn().mockResolvedValue(undefined),
  recipientsSource: 'firebase' as const,
  isRecipientsSyncing: false,
  recipientsSyncError: null,
  message: 'Mensaje inicial',
  onMessageChange: vi.fn(),
  onResetMessage: vi.fn(),
  date: '2026-02-15',
  nursesSignature: 'Firma',
  isAdminUser: true,
  testModeEnabled: false,
  onTestModeChange: vi.fn(),
  testRecipient: '',
  onTestRecipientChange: vi.fn(),
});

describe('CensusEmailConfigModal', () => {
  it('adds a recipient through the named icon button', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Agregar correo…'), {
      target: { value: 'b@example.test' },
    });
    const button = screen.getByRole('button', { name: 'Agregar correo' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.textContent).toBe('');
    fireEvent.click(button);
    expect(props.onRecipientsChange).toHaveBeenCalledWith(['a@mail.com', 'b@example.test']);
  });

  it('adds recipient from single input and normalizes email', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    const input = screen.getByPlaceholderText('Agregar correo…');

    fireEvent.change(input, {
      target: { value: ' B@MAIL.COM ' },
    });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onRecipientsChange).toHaveBeenCalledWith(['a@mail.com', 'b@mail.com']);
  });

  it('validates bulk editor input and shows error for invalid email', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    fireEvent.click(screen.getByText(/edición masiva/i));
    fireEvent.change(screen.getByPlaceholderText(/ejemplo1@hospital.cl/i), {
      target: { value: 'ok@mail.com,not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText(/correo inválido/i)).toBeInTheDocument();
    expect(props.onRecipientsChange).not.toHaveBeenCalled();
  });

  it('delegates reset message action', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    fireEvent.click(screen.getByText(/restablecer/i));
    expect(props.onResetMessage).toHaveBeenCalled();
  });

  it('falls back to default reset message when callback is missing', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} onResetMessage={undefined} />);

    fireEvent.click(screen.getByText(/restablecer/i));
    expect(props.onMessageChange).toHaveBeenCalled();
  });

  it('does not show the removed excel configuration box', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    expect(
      screen.queryByText(/el excel adjunta siempre el día actual con la hora real del envío/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/la variante con corte a las 23:59 fue eliminada/i)
    ).not.toBeInTheDocument();
  });

  it('shows the global firebase recipients hint', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    expect(screen.getByText(/lista global sincronizada con firebase/i)).toBeInTheDocument();
  });

  it('creates a new named recipient list', async () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /^crear lista$/i }));
    fireEvent.change(screen.getByPlaceholderText(/nueva lista de correos/i), {
      target: { value: 'Jefatura' },
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /crear/i })[1]);
    });

    expect(props.onCreateRecipientList).toHaveBeenCalledWith('Jefatura');
  });
});
