import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContextType } from '@/context/AuthContext';
import type { DateStripRadiologyViewer } from '@/components/layout/date-strip/dateStripRadiologyViewer';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { AuthenticatedAppShell } from '@/app-shell/runtime/AuthenticatedAppShell';

const { appContentProps } = vi.hoisted(() => ({
  appContentProps: [] as Array<{ radiologyViewer?: DateStripRadiologyViewer }>,
}));

vi.mock('@/components/layout/AppContent', () => ({
  AppContent: (props: { radiologyViewer?: DateStripRadiologyViewer }) => {
    appContentProps.push(props);
    return null;
  },
}));

vi.mock('@/features/radiology/components/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({
    isOpen,
    patients,
  }: {
    isOpen: boolean;
    patients: Array<{ patientName: string }>;
  }) => (isOpen ? <div>MMRAD viewer for {patients[0]?.patientName}</div> : null),
}));

vi.mock('@/app-shell/runtime/useAuthenticatedAppRuntime', () => ({
  useAuthenticatedAppRuntime: () => ({ dailyRecordHook: {}, censusContextValue: {}, ui: {} }),
}));

vi.mock('@/components/AppProviders', () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useWarmDailyRecordSavePath', () => ({
  useWarmDailyRecordSavePath: () => undefined,
}));

vi.mock('@/app-shell/runtime/DeferredSystemHealthReporter', () => ({
  DeferredSystemHealthReporter: () => null,
}));

vi.mock('@/context/CensusContext', () => ({
  CensusProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AuthenticatedAppShell radiology viewer', () => {
  it('hands the date strip the MMRAD viewer from the radiology feature', async () => {
    render(
      <AuthenticatedAppShell auth={{} as AuthContextType} dateNav={{} as UseDateNavigationReturn} />
    );

    const RadiologyViewer = appContentProps.at(-1)?.radiologyViewer;
    expect(RadiologyViewer).toBeDefined();
    if (!RadiologyViewer) return;

    render(
      <React.Suspense fallback={null}>
        <RadiologyViewer
          isOpen
          onClose={vi.fn()}
          patients={[
            { bedId: 'R1', label: 'R1', patientName: 'Paciente Sintético', rut: '12.345.678-5' },
          ]}
        />
      </React.Suspense>
    );

    expect(await screen.findByText('MMRAD viewer for Paciente Sintético')).toBeInTheDocument();
  });
});
