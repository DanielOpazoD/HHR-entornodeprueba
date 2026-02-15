import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusEmailConfigModal } from '@/features/census/components/CensusEmailConfigModal';

const buildProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  recipients: ['a@mail.com'],
  onRecipientsChange: vi.fn(),
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
  it('adds recipient from single input and normalizes email', () => {
    const props = buildProps();
    render(<CensusEmailConfigModal {...props} />);

    const input = screen.getByPlaceholderText('Agregar correo...');

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
});
