import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseLoginPageController = vi.fn();

vi.mock('@/features/auth/components/useLoginPageController', () => ({
  useLoginPageController: () => mockUseLoginPageController(),
}));

vi.mock('@/features/auth/components/LoginPageHeader', () => ({
  LoginPageHeader: () => <div data-testid="login-header" />,
}));

vi.mock('@/features/auth/components/LoginPageCard', () => ({
  LoginPageCard: () => <div data-testid="login-card" />,
}));

vi.mock('@/features/auth/components/LoginPageFooter', () => ({
  LoginPageFooter: () => <div data-testid="login-footer" />,
}));

import { LoginPage } from '@/features/auth/components/LoginPage';

const arrangeLoginController = (isDayGradient: boolean) => {
  mockUseLoginPageController.mockReturnValue({
    error: null,
    errorCode: null,
    isGoogleLoading: false,
    isAnyLoading: false,
    isDayGradient,
    canRetryGoogleSignIn: false,
    handleGoogleSignIn: vi.fn(),
    handleLocalResetStart: vi.fn(),
    toggleBackgroundMode: vi.fn(),
  });
};

const getRenderedLoginBackgrounds = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-testid="login-background-image"]')].map(
    element => element.style.backgroundImage
  );

describe('LoginPage performance contract', () => {
  it('renders only the active optimized background on first paint', () => {
    arrangeLoginController(true);

    const { container } = render(<LoginPage onLoginSuccess={vi.fn()} />);

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(getRenderedLoginBackgrounds(container)).toEqual([
      'url("/images/login/hhr-login-day.webp")',
    ]);
  });
});
