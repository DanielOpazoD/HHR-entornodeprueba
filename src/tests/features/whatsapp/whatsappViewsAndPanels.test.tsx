import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockSendWhatsAppMessage = vi.fn();
const mockGetWhatsAppConfig = vi.fn();
const mockGetMessageTemplates = vi.fn();
const mockFormatHandoffMessage = vi.fn();
const mockSaveMessageTemplates = vi.fn();

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({
    confirm: vi.fn().mockResolvedValue(true),
  }),
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => mockSendWhatsAppMessage(...args),
  getWhatsAppConfig: (...args: unknown[]) => mockGetWhatsAppConfig(...args),
  getMessageTemplates: (...args: unknown[]) => mockGetMessageTemplates(...args),
  formatHandoffMessage: (...args: unknown[]) => mockFormatHandoffMessage(...args),
  saveMessageTemplates: (...args: unknown[]) => mockSaveMessageTemplates(...args),
  saveManualShift: vi.fn().mockResolvedValue({ success: true }),
  subscribeToCurrentShift: vi.fn((cb: (data: null) => void) => {
    cb(null);
    return () => undefined;
  }),
  fetchShiftsFromGroup: vi.fn().mockResolvedValue({ success: true, message: 'Found shifts' }),
  getDefaultTemplates: vi.fn(() => []),
  checkBotHealth: vi.fn().mockResolvedValue({ status: 'ok', whatsapp: 'connected' }),
  getWhatsAppGroups: vi.fn().mockResolvedValue([]),
  updateWhatsAppConfig: vi.fn().mockResolvedValue(true),
  logWhatsAppOperation: vi.fn(),
}));

vi.mock('@/hooks/useWhatsAppQuery', () => ({
  useWhatsAppConfigQuery: vi.fn(() => ({
    data: {
      enabled: true,
      status: 'connected',
      shiftParser: { enabled: true, sourceGroupId: 'g1' },
      handoffNotifications: { enabled: true, targetGroupId: 'g2', autoSendTime: '17:00' },
    },
    isLoading: false,
    refetch: vi.fn(),
  })),
  useWhatsAppHealthQuery: vi.fn(() => ({
    data: 'connected',
    isLoading: false,
    refetch: vi.fn(),
  })),
  useWhatsAppGroupsQuery: vi.fn(() => ({
    data: [
      { id: 'g1', name: 'Grupo Turnos' },
      { id: 'g2', name: 'Grupo Entregas' },
    ],
    isLoading: false,
  })),
  useUpdateWhatsAppConfigMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  })),
  whatsappKeys: { all: ['whatsapp'], config: () => ['whatsapp', 'config'] },
}));

vi.mock('@/hooks/useShiftPanel', () => ({
  useShiftPanel: vi.fn(() => ({
    shift: null,
    loading: false,
    showOriginal: false,
    showImportModal: false,
    setShowImportModal: vi.fn(),
    importMessage: '',
    setImportMessage: vi.fn(),
    importing: false,
    importError: null,
    fetching: false,
    fetchResult: null,
    handleImport: vi.fn(),
    handleFetchFromGroup: vi.fn(),
    toggleViewMode: vi.fn(),
  })),
}));

vi.mock('@/shared/runtime/browserWindowRuntime', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime(),
  };
});

vi.mock('@/utils/dateFormattingUtils', () => ({
  formatDateDDMMYYYY: (d: string) => d,
}));

import { useShiftPanel } from '@/hooks/useShiftPanel';
import { WhatsAppIntegrationView } from '@/features/whatsapp/components/WhatsAppIntegrationView';
import { ShiftPanelView } from '@/features/whatsapp/components/ShiftPanelView';
import { ImportModal } from '@/features/whatsapp/components/internal/ImportModal';
import { StaffCard } from '@/features/whatsapp/components/internal/StaffCard';

describe('WhatsAppIntegrationView', () => {
  it('renders header and default shifts tab', () => {
    render(<WhatsAppIntegrationView />);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Turnos Pabellón')).toBeInTheDocument();
  });

  it('switches between tabs', () => {
    render(<WhatsAppIntegrationView />);

    fireEvent.click(screen.getByText('Plantillas'));
    fireEvent.click(screen.getByText('Configuración'));
  });

  it('shows all three tab labels', () => {
    render(<WhatsAppIntegrationView />);
    expect(screen.getByText('Turnos Pabellón')).toBeInTheDocument();
    expect(screen.getByText('Plantillas')).toBeInTheDocument();
    expect(screen.getByText('Configuración')).toBeInTheDocument();
  });
});

describe('ImportModal', () => {
  const baseProps = {
    message: '',
    setMessage: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
    importing: false,
    error: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the import modal with header and textarea', () => {
    render(<ImportModal {...baseProps} />);
    expect(screen.getByText('Importar Turno de Pabellón')).toBeInTheDocument();
  });

  it('disables import button when message is empty', () => {
    render(<ImportModal {...baseProps} />);
    const importButton = screen.getByText('Importar Turno');
    expect(importButton.closest('button')).toBeDisabled();
  });

  it('enables import button when message has content', () => {
    render(<ImportModal {...baseProps} message="turno data here" />);
    const importButton = screen.getByText('Importar Turno');
    expect(importButton.closest('button')).not.toBeDisabled();
  });

  it('shows importing state', () => {
    render(<ImportModal {...baseProps} message="data" importing={true} />);
    expect(screen.getByText('Importando...')).toBeInTheDocument();
  });

  it('shows error message when provided', () => {
    render(<ImportModal {...baseProps} error="Error parsing message" />);
    expect(screen.getByText(/Error parsing message/)).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<ImportModal {...baseProps} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', () => {
    render(<ImportModal {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onImport when import button is clicked', () => {
    render(<ImportModal {...baseProps} message="turno content" />);
    fireEvent.click(screen.getByText('Importar Turno'));
    expect(baseProps.onImport).toHaveBeenCalledTimes(1);
  });
});

describe('ShiftPanelView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no shift is available', () => {
    render(<ShiftPanelView />);
    expect(screen.getByText('No hay turno vigente')).toBeInTheDocument();
    expect(screen.getByText(/Buscar en Grupo de WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByText('Importar Manualmente')).toBeInTheDocument();
  });

  it('shows loading spinner when loading is true', () => {
    vi.mocked(useShiftPanel).mockReturnValue({
      shift: null,
      loading: true,
      showOriginal: false,
      showImportModal: false,
      setShowImportModal: vi.fn(),
      importMessage: '',
      setImportMessage: vi.fn(),
      importing: false,
      importError: '',
      fetching: false,
      fetchResult: null,
      handleImport: vi.fn(),
      handleFetchFromGroup: vi.fn(),
      toggleViewMode: vi.fn(),
    });

    const { container } = render(<ShiftPanelView />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders staff grid when shift has staff data', () => {
    vi.mocked(useShiftPanel).mockReturnValue({
      shift: {
        startDate: '2026-03-10',
        endDate: '2026-03-17',
        source: 'whatsapp' as const,
        parsedAt: '2026-03-10T10:00:00.000Z',
        staff: [
          {
            role: 'Cirujana',
            name: 'Dra. Maria',
            phone: '+56912345678',
            whatsappUrl: 'https://wa.me/56912345678',
          },
        ],
        originalMessage: 'Turno pabellon...',
      },
      loading: false,
      showOriginal: false,
      showImportModal: false,
      setShowImportModal: vi.fn(),
      importMessage: '',
      setImportMessage: vi.fn(),
      importing: false,
      importError: '',
      fetching: false,
      fetchResult: null,
      handleImport: vi.fn(),
      handleFetchFromGroup: vi.fn(),
      toggleViewMode: vi.fn(),
    });

    render(<ShiftPanelView />);
    expect(screen.getByText('Turno Pabellón')).toBeInTheDocument();
    expect(screen.getByText('Dra. Maria')).toBeInTheDocument();
    expect(screen.getByText('Cirujana')).toBeInTheDocument();
  });
});

describe('StaffCard extended', () => {
  it('renders member role, name and phone', () => {
    const member = {
      role: 'Anestesista',
      name: 'Dr. Juan',
      phone: '+56999887766',
      whatsappUrl: 'https://wa.me/56999887766',
    };

    render(<StaffCard member={member} />);
    expect(screen.getByText('Anestesista')).toBeInTheDocument();
    expect(screen.getByText('Dr. Juan')).toBeInTheDocument();
  });

  it('renders notes when provided', () => {
    const member = {
      role: 'EU',
      name: 'Ana',
      phone: '+56900000000',
      whatsappUrl: 'https://wa.me/56900000000',
      notes: 'Hasta las 20:00',
    };

    render(<StaffCard member={member} />);
    expect(screen.getByText(/Hasta las 20:00/)).toBeInTheDocument();
  });

  it('renders replacement info when present', () => {
    const member = {
      role: 'EU',
      name: 'Ana',
      phone: '+56900000000',
      whatsappUrl: 'https://wa.me/56900000000',
      replacement: {
        name: 'Carmen',
        phone: '+56911111111',
        whatsappUrl: 'https://wa.me/56911111111',
        startDate: '2026-03-13',
      },
    };

    render(<StaffCard member={member} />);
    expect(screen.getByText('Carmen')).toBeInTheDocument();
    expect(screen.getByText('+56911111111')).toBeInTheDocument();
  });

  it('does not render replacement section when absent', () => {
    const member = {
      role: 'EU',
      name: 'Ana',
      phone: '+56900000000',
      whatsappUrl: 'https://wa.me/56900000000',
    };

    render(<StaffCard member={member} />);
    expect(screen.queryByText('Luego:')).not.toBeInTheDocument();
  });
});
