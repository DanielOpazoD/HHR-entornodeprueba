import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SystemDiagnosticsView } from '@/features/admin/components/SystemDiagnosticsView';

vi.mock('@/features/admin/components/AuditView', () => ({
  AuditView: () => <div>Audit View</div>,
}));

vi.mock('@/features/admin/components/FunctionsTelemetryView', () => ({
  FunctionsTelemetryView: () => <div>Functions Telemetry View</div>,
}));

vi.mock('@/features/admin/components/SystemHealthDashboard', () => ({
  SystemHealthDashboard: () => <div>System Health</div>,
}));

vi.mock('@/features/admin/components/LocalErrorLogsView', () => ({
  LocalErrorLogsView: () => <div>Local Error Logs View</div>,
}));

describe('SystemDiagnosticsView (Observabilidad)', () => {
  it('renders the audit tab by default', () => {
    render(<SystemDiagnosticsView />);
    expect(screen.getByText('Audit View')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /errores locales/i })).toBeInTheDocument();
  });

  it('switches to the services telemetry tab on click', async () => {
    const user = userEvent.setup();
    render(<SystemDiagnosticsView />);

    await user.click(screen.getByRole('button', { name: /servicios externos/i }));

    expect(screen.getByText('Functions Telemetry View')).toBeInTheDocument();
  });

  it('switches to the user health tab on click', async () => {
    const user = userEvent.setup();
    render(<SystemDiagnosticsView />);

    await user.click(screen.getByRole('button', { name: /salud de usuarios/i }));

    expect(screen.getByText('System Health')).toBeInTheDocument();
  });

  it('switches to the local technical error logs tab on click', async () => {
    const user = userEvent.setup();
    render(<SystemDiagnosticsView />);

    await user.click(screen.getByRole('button', { name: /errores locales/i }));

    expect(screen.getByText('Local Error Logs View')).toBeInTheDocument();
  });
});
