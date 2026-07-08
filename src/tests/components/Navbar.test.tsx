import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReminderBadgeFallback } from '@/components/layout/Navbar';

describe('Navbar fallback slots', () => {
  it('keeps the notification icon visible while the reminder badge chunk loads', () => {
    render(<ReminderBadgeFallback />);

    const fallback = screen.getByLabelText('Avisos cargando');
    expect(fallback).toHaveClass('h-8');
    expect(fallback).toHaveClass('w-[58px]');
    expect(fallback.querySelector('svg')).not.toBeNull();
  });
});
