import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { StaffCard } from '@/features/whatsapp/components/components/StaffCard';

const mockOpen = vi.fn();

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    open: (...args: unknown[]) => mockOpen(...args),
  },
}));

describe('StaffCard', () => {
  const member = {
    id: 'm1',
    name: 'Ana Perez',
    role: 'Enfermera',
    phone: '+56911111111',
    whatsappUrl: 'https://wa.me/56911111111',
    notes: 'Turno noche',
  };

  it('opens tel and whatsapp links through runtime adapter', () => {
    render(<StaffCard member={member} />);

    fireEvent.click(screen.getByRole('button', { name: /Llamar/i }));
    expect(mockOpen).toHaveBeenCalledWith('tel:+56911111111', '_self');

    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/i }));
    expect(mockOpen).toHaveBeenCalledWith('https://wa.me/56911111111', '_blank');
  });
});
