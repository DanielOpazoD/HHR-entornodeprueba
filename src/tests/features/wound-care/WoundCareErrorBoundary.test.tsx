import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWoundCareErrorLogger } = vi.hoisted(() => ({
  mockWoundCareErrorLogger: vi.fn(),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock({ error: mockWoundCareErrorLogger });
});

import { WoundCareErrorBoundary } from '@/features/wound-care/components/WoundCareErrorBoundary';

const ThrowingChild = () => {
  throw new Error('boundary exploded');
};

describe('WoundCareErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs render failures through the structured logger and shows the fallback UI', () => {
    render(
      <WoundCareErrorBoundary patientName="Paciente Demo">
        <ThrowingChild />
      </WoundCareErrorBoundary>
    );

    expect(
      screen.getByText('Error al cargar el registro fotográfico de Paciente Demo')
    ).toBeTruthy();
    expect(mockWoundCareErrorLogger).toHaveBeenCalledWith(
      'Error boundary caught',
      expect.objectContaining({
        error: expect.any(Error),
        componentStack: expect.any(String),
        patientName: 'Paciente Demo',
      })
    );
  });
});
