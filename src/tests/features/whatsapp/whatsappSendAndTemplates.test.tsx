import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSendWhatsAppMessage = vi.fn();
const mockGetWhatsAppConfig = vi.fn();
const mockGetMessageTemplates = vi.fn();
const mockFormatHandoffMessage = vi.fn();
const mockSaveMessageTemplates = vi.fn();

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

import { WhatsAppSendButton } from '@/features/whatsapp/components/WhatsAppSendButton';
import {
  formatHandoffMessage,
  getDefaultTemplates,
} from '@/services/integrations/whatsapp/whatsappTemplatesStore';
import { buildBotUrl } from '@/services/integrations/whatsapp/whatsappBotRuntime';

const handoffData = {
  id: 'h-1',
  date: '2026-03-10',
  signedBy: 'Dr. Perez',
  signedAt: '14:00',
  hospitalized: 12,
  freeBeds: 5,
  newAdmissions: 2,
  discharges: 1,
};

describe('WhatsAppSendButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state with send button', () => {
    render(<WhatsAppSendButton handoffData={handoffData} />);
    expect(screen.getByText('Enviar a WhatsApp')).toBeInTheDocument();
  });

  it('renders sent state when whatsappStatus.sent is true', () => {
    render(
      <WhatsAppSendButton
        handoffData={handoffData}
        whatsappStatus={{ sent: true, sentAt: '14:30', method: 'MANUAL' }}
      />
    );
    expect(screen.getByText('Enviado a WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('(14:30)')).toBeInTheDocument();
  });

  it('shows automatic label when method is AUTO', () => {
    render(
      <WhatsAppSendButton
        handoffData={handoffData}
        whatsappStatus={{ sent: true, sentAt: '17:00', method: 'AUTO' }}
      />
    );
    expect(screen.getByText('(17:00)')).toBeInTheDocument();
    expect(screen.getByText(/autom/i)).toBeInTheDocument();
  });

  it('shows sending state while in progress', async () => {
    mockGetWhatsAppConfig.mockReturnValue(new Promise(() => {}));
    render(<WhatsAppSendButton handoffData={handoffData} />);

    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(screen.getByText('Enviando...')).toBeInTheDocument();
    });
  });

  it('shows error state and retry button when send fails', async () => {
    mockGetWhatsAppConfig.mockResolvedValue({
      handoffNotifications: { enabled: true, targetGroupId: 'g1' },
    });
    mockGetMessageTemplates.mockResolvedValue([
      { id: '1', type: 'handoff', content: 'test {{date}}' },
    ]);
    mockFormatHandoffMessage.mockReturnValue('formatted');
    mockSendWhatsAppMessage.mockResolvedValue({
      success: false,
      error: 'Connection lost',
    });

    render(<WhatsAppSendButton handoffData={handoffData} />);
    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });

    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });

  it('shows error when notifications are disabled', async () => {
    mockGetWhatsAppConfig.mockResolvedValue({
      handoffNotifications: { enabled: false, targetGroupId: 'g1' },
    });

    render(<WhatsAppSendButton handoffData={handoffData} />);
    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(screen.getByText(/desactivadas/i)).toBeInTheDocument();
    });
  });

  it('shows error when no target group is configured', async () => {
    mockGetWhatsAppConfig.mockResolvedValue({
      handoffNotifications: { enabled: true, targetGroupId: '' },
    });

    render(<WhatsAppSendButton handoffData={handoffData} />);
    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(screen.getByText(/no configurado/i)).toBeInTheDocument();
    });
  });

  it('shows error when no message template exists', async () => {
    mockGetWhatsAppConfig.mockResolvedValue({
      handoffNotifications: { enabled: true, targetGroupId: 'g1' },
    });
    mockGetMessageTemplates.mockResolvedValue([]);

    render(<WhatsAppSendButton handoffData={handoffData} />);
    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(screen.getByText(/plantilla/i)).toBeInTheDocument();
    });
  });

  it('calls onSent callback after successful send', async () => {
    mockGetWhatsAppConfig.mockResolvedValue({
      handoffNotifications: { enabled: true, targetGroupId: 'g1' },
    });
    mockGetMessageTemplates.mockResolvedValue([
      { id: '1', type: 'handoff', content: 'test {{date}}' },
    ]);
    mockFormatHandoffMessage.mockReturnValue('formatted');
    mockSendWhatsAppMessage.mockResolvedValue({
      success: true,
      messageId: 'msg-1',
    });

    const onSent = vi.fn();
    render(<WhatsAppSendButton handoffData={handoffData} onSent={onSent} />);
    fireEvent.click(screen.getByText('Enviar a WhatsApp'));

    await waitFor(() => {
      expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });
});

describe('formatHandoffMessage', () => {
  it('replaces all template variables', () => {
    const template =
      'Date: {{date}}, By: {{signedBy}}, At: {{signedAt}}, Hosp: {{hospitalized}}, Free: {{freeBeds}}, New: {{newAdmissions}}, Disc: {{discharges}}, URL: {{handoffUrl}}, Crit: {{criticalPatients}}';

    const result = formatHandoffMessage(template, {
      date: '2026-03-10',
      signedBy: 'Dr. Test',
      signedAt: '14:00',
      hospitalized: 12,
      freeBeds: 5,
      newAdmissions: 2,
      discharges: 1,
      handoffUrl: 'https://app.test/handoff/1',
      criticalPatients: 3,
    });

    expect(result).toContain('2026-03-10');
    expect(result).toContain('Dr. Test');
    expect(result).toContain('14:00');
    expect(result).toContain('12');
    expect(result).toContain('5');
    expect(result).toContain('2');
    expect(result).toContain('1');
    expect(result).toContain('https://app.test/handoff/1');
    expect(result).toContain('3');
  });

  it('defaults criticalPatients to 0 when not provided', () => {
    const template = 'Critical: {{criticalPatients}}';
    const result = formatHandoffMessage(template, {
      date: '',
      signedBy: '',
      signedAt: '',
      hospitalized: 0,
      freeBeds: 0,
      newAdmissions: 0,
      discharges: 0,
      handoffUrl: '',
    });
    expect(result).toBe('Critical: 0');
  });

  it('handles multiple occurrences of the same variable', () => {
    const template = '{{date}} - {{date}}';
    const result = formatHandoffMessage(template, {
      date: '2026-03-10',
      signedBy: '',
      signedAt: '',
      hospitalized: 0,
      freeBeds: 0,
      newAdmissions: 0,
      discharges: 0,
      handoffUrl: '',
    });
    expect(result).toBe('2026-03-10 - 2026-03-10');
  });
});

describe('getDefaultTemplates', () => {
  it('returns at least one default template', () => {
    const defaults = getDefaultTemplates();
    expect(defaults.length).toBeGreaterThanOrEqual(1);
  });

  it('includes a handoff type template', () => {
    const defaults = getDefaultTemplates();
    const handoff = defaults.find(t => t.type === 'handoff');
    expect(handoff).toBeDefined();
    expect(handoff!.content).toContain('{{date}}');
  });
});

describe('buildBotUrl', () => {
  it('normalizes paths with leading slash', () => {
    const url = buildBotUrl('/health');
    expect(url).toMatch(/\/health$/);
  });

  it('adds a leading slash when path lacks one', () => {
    const url = buildBotUrl('groups');
    expect(url).toMatch(/\/groups$/);
  });
});
