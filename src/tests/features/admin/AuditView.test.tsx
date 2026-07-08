import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditView } from '@/features/admin/components/AuditView';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/useAuditData', () => ({
  useAuditData: () => ({
    logs: [],
    filteredLogs: [{ id: 'log-1' }],
    displayLogs: [{ id: 'log-1' }],
    paginatedLogs: [{ id: 'log-1' }],
    patientPackages: [],
    paginatedPatientPackages: [],
    stats: {},
    loading: false,
    fetchLimit: 500,
    canLoadMoreLogs: false,
    filters: {
      searchTerm: '',
      filterAction: '',
      startDate: '',
      endDate: '',
      activeSection: 'SESSIONS',
      compactView: false,
      groupedView: false,
    },
    setSearchTerm: vi.fn(),
    setFilterAction: vi.fn(),
    setStartDate: vi.fn(),
    setEndDate: vi.fn(),
    applyDateRangePreset: vi.fn(),
    setActiveSection: vi.fn(),
    setCompactView: vi.fn(),
    setGroupedView: vi.fn(),
    expandedRows: {},
    toggleRow: vi.fn(),
    fetchLogs: vi.fn(),
    loadMoreLogs: vi.fn(),
    sections: {},
    currentPage: 1,
    totalPages: 1,
    setCurrentPage: vi.fn(),
    ITEMS_PER_PAGE: 25,
  }),
}));

vi.mock('@/features/admin/components/hooks/useAuditExport', () => ({
  useAuditExport: () => ({
    isExporting: false,
    handleExcelExport: vi.fn(),
    handlePdfExport: vi.fn(),
  }),
}));

vi.mock('@/features/admin/components/hooks/useAuditConsolidation', () => ({
  useAuditConsolidation: () => ({
    isConsolidating: false,
    handleConsolidate: vi.fn(),
  }),
}));

vi.mock('@/features/admin/components/internal/AccessRestricted', () => ({
  AccessRestricted: () => <div>Restricted</div>,
}));

vi.mock('@/features/admin/components/internal/audit/AuditStatsDashboard', () => ({
  AuditStatsDashboard: () => <div>Stats</div>,
}));

vi.mock('@/features/admin/components/internal/audit/AuditFilters', () => ({
  AuditFilters: () => <div>Filters</div>,
}));

vi.mock('@/features/admin/components/internal/audit/AuditSectionTabs', () => ({
  AuditSectionTabs: () => <div>Tabs</div>,
}));

vi.mock('@/features/admin/components/internal/audit/AuditDynamicPanels', () => ({
  AuditDynamicPanels: () => <div>Panels</div>,
}));

vi.mock('@/features/admin/components/internal/audit/AuditTable', () => ({
  AuditTable: () => <div>Table</div>,
}));

describe('AuditView', () => {
  const mockedUseAuth = vi.mocked(useAuth);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the consolidate action visible for canonical admins outside the hardcoded email list', () => {
    mockedUseAuth.mockReturnValue({
      role: 'admin',
      currentUser: {
        uid: 'user-1',
        email: 'admin.canonical@hospitalhangaroa.cl',
        displayName: 'Admin Canonico',
        role: 'admin',
      },
      authorizedUser: null,
      sessionState: { status: 'authorized', user: { uid: 'user-1' } },
      authLoading: false,
      isFirebaseConnected: true,
      remoteSyncStatus: 'ready',
      remoteSyncState: { mode: 'enabled', reason: 'ready' },
      authRuntime: {
        sessionStatus: 'authorized',
        authLoading: false,
        isFirebaseConnected: true,
        isOnline: true,
        bootstrapPending: false,
        pendingAgeMs: 0,
        budgetProfile: { warnAfterMs: 0, timeoutMs: 0 },
        timeoutMs: 0,
        runtimeState: 'ready',
        issues: [],
      },
      isEditor: true,
      isViewer: false,
      handleLogout: vi.fn(),
    } as never);

    render(<AuditView />);

    expect(screen.getByRole('button', { name: /consolidar/i })).toBeInTheDocument();
  });

  it('keeps non-admin roles blocked even if the email previously matched the old fallback', () => {
    mockedUseAuth.mockReturnValue({
      role: 'viewer',
      currentUser: {
        uid: 'user-2',
        email: 'daniel.opazo@hospitalhangaroa.cl',
        displayName: 'Viewer Fallback',
        role: 'viewer',
      },
      authorizedUser: null,
      sessionState: { status: 'authorized', user: { uid: 'user-2' } },
      authLoading: false,
      isFirebaseConnected: true,
      remoteSyncStatus: 'ready',
      remoteSyncState: { mode: 'enabled', reason: 'ready' },
      authRuntime: {
        sessionStatus: 'authorized',
        authLoading: false,
        isFirebaseConnected: true,
        isOnline: true,
        bootstrapPending: false,
        pendingAgeMs: 0,
        budgetProfile: { warnAfterMs: 0, timeoutMs: 0 },
        timeoutMs: 0,
        runtimeState: 'ready',
        issues: [],
      },
      isEditor: false,
      isViewer: true,
      handleLogout: vi.fn(),
    } as never);

    render(<AuditView />);

    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /consolidar/i })).not.toBeInTheDocument();
  });
});
