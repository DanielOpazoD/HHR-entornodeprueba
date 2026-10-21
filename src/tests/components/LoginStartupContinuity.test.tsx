import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';

describe('RUT login startup continuity', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the current credential layout visible but inactive until auth is ready', () => {
    localStorage.setItem('hhr_login_background_mode', 'night');
    const { container } = render(<InitialLoadingScreen pathname="/" />);
    expect(screen.getByRole('heading', { name: 'Hospital Hanga Roa' })).toBeVisible();
    expect(screen.getByLabelText('Usuario')).toBeDisabled();
    expect(screen.getByLabelText('Contraseña')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Ingresar$/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando acceso');
    expect(container.querySelector('summary')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
