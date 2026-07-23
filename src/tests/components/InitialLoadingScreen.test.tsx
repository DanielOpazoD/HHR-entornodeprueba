import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  InitialLoadingScreen,
  resolveInitialLoadingScreenVariant,
} from '@/components/ui/InitialLoadingScreen';

describe('InitialLoadingScreen', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('resolves the login shell variant for the root route', () => {
    expect(resolveInitialLoadingScreenVariant('/')).toBe('login-shell');
  });

  it('falls back to the default loader on the root route when login shell is not preferred', () => {
    expect(resolveInitialLoadingScreenVariant('/', { preferLoginShell: false })).toBe('default');
  });

  it('resolves the default loader variant for authenticated module routes', () => {
    expect(resolveInitialLoadingScreenVariant('/census')).toBe('default');
    expect(resolveInitialLoadingScreenVariant('/census/')).toBe('default');
    expect(resolveInitialLoadingScreenVariant('/nursing-handoff')).toBe('default');
    expect(resolveInitialLoadingScreenVariant('/medical-handoff')).toBe('default');
    expect(resolveInitialLoadingScreenVariant('/transfer-management')).toBe('default');
    expect(resolveInitialLoadingScreenVariant('/whatsapp')).toBe('default');
  });

  it('renders the login shell without a startup spinner for the root route', () => {
    window.localStorage.setItem('hhr_login_background_mode', 'day');

    const { container } = render(<InitialLoadingScreen pathname="/" />);

    expect(screen.getByTestId('login-loading-shell')).toBeInTheDocument();
    expect(screen.getByTestId('login-loading-shell')).toHaveAttribute(
      'data-background-mode',
      'day'
    );
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByTestId('initial-loading-spinner')).not.toBeInTheDocument();
  });

  it('preserves the night login background during startup refresh', () => {
    window.localStorage.setItem('hhr_login_background_mode', 'night');

    render(<InitialLoadingScreen pathname="/" />);

    expect(screen.getByTestId('login-loading-shell')).toHaveAttribute(
      'data-background-mode',
      'night'
    );
    expect(screen.getByTestId('login-loading-shell')).toHaveAttribute(
      'data-background-image',
      '/images/login/hhr-login-night.webp'
    );
  });

  it('renders the default loading screen for non-census routes', () => {
    render(<InitialLoadingScreen pathname="/whatsapp" />);

    expect(screen.getByTestId('default-loading-screen')).toBeInTheDocument();
  });

  it('renders the default loading screen on the root route when login shell is suppressed', () => {
    render(<InitialLoadingScreen pathname="/" preferLoginShell={false} />);

    expect(screen.getByTestId('default-loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('login-loading-shell')).not.toBeInTheDocument();
  });
});
