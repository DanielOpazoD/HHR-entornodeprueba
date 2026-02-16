import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useHandoffCommunication } from '@/hooks/useHandoffCommunication';

const mockWriteClipboardText = vi.fn();
const mockOpen = vi.fn();

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    getLocationOrigin: () => 'https://hhr.test',
    open: (...args: unknown[]) => mockOpen(...args),
  },
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}));

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  getWhatsAppConfig: vi.fn(),
  getMessageTemplates: vi.fn(),
}));

import { getMessageTemplates } from '@/services/integrations/whatsapp/whatsappService';

describe('useHandoffCommunication', () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies signature link using runtime clipboard adapter', async () => {
    mockWriteClipboardText.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useHandoffCommunication(
        {
          date: '2026-02-15',
          beds: {},
          discharges: [],
          transfers: [],
          cma: [],
          lastUpdated: '',
          nurses: [],
          activeExtraBeds: [],
        } as any,
        [],
        vi.fn(),
        onSuccess
      )
    );

    act(() => {
      result.current.handleShareLink();
    });

    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith(
        'https://hhr.test?mode=signature&date=2026-02-15'
      );
      expect(onSuccess).toHaveBeenCalledWith(
        'Enlace copiado',
        'El link para firma médica ha sido copiado al portapapeles.'
      );
    });
  });

  it('reports clipboard runtime error when copy fails', async () => {
    mockWriteClipboardText.mockRejectedValue(new Error('Clipboard blocked'));

    const { result } = renderHook(() =>
      useHandoffCommunication(
        {
          date: '2026-02-15',
          beds: {},
          discharges: [],
          transfers: [],
          cma: [],
          lastUpdated: '',
          nurses: [],
          activeExtraBeds: [],
        } as any,
        [],
        vi.fn(),
        onSuccess
      )
    );

    act(() => {
      result.current.handleShareLink();
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('Clipboard blocked');
    });
  });

  it('opens manual WhatsApp URL through runtime adapter', async () => {
    vi.mocked(getMessageTemplates).mockResolvedValue([
      { type: 'handoff', content: 'handoff-template' },
    ] as any);

    const record = {
      date: '2026-02-15',
      beds: {
        'B-1': { patientName: 'Paciente', isBlocked: false },
      },
      medicalHandoffDoctor: 'Dr. Test',
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      nurses: [],
      activeExtraBeds: [],
    } as any;

    const { result } = renderHook(() =>
      useHandoffCommunication(record, [{ id: 'B-1' }], vi.fn(), onSuccess)
    );

    await act(async () => {
      await result.current.handleSendWhatsAppManual();
    });

    expect(mockOpen).toHaveBeenCalled();
    expect(String(mockOpen.mock.calls[0]?.[0] || '')).toContain(
      'https://api.whatsapp.com/send?text='
    );
  });
});
