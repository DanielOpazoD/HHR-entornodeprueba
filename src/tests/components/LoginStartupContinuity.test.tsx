import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';

describe('RUT login startup continuity', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the access progress visible without restoring credential fields', () => {
    localStorage.setItem('hhr_login_background_mode', 'night');
    const { container } = render(<InitialLoadingScreen pathname="/" />);
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ingresar$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Validando tu acceso');
    expect(container.querySelector('summary')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
