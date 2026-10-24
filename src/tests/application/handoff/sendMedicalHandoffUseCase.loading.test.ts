import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { executeSendMedicalHandoff } from '@/application/handoff/sendMedicalHandoffUseCase';

const transport = vi.hoisted(() => {
  let release = () => {};
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    defer: false,
    gate,
    release,
    loaded: vi.fn(),
    send: vi.fn().mockResolvedValue({ success: true }),
  };
});

vi.mock('@/services/integrations/whatsapp/whatsappService', async () => {
  transport.loaded();
  if (transport.defer) await transport.gate;
  return {
    formatHandoffMessage: () => 'Entrega sintética',
    sendWhatsAppMessage: transport.send,
  };
});

const createInput = () => ({
  record: DataFactory.createMockDailyRecord('2026-03-05', {
    medicalHandoffDoctor: 'Dra. Prueba Sintética',
    medicalSignatureLinkTokenByScope: { all: 'synthetic-signature-token' },
  }),
  templateContent: 'Entrega sintética',
  targetGroupId: 'synthetic-group',
  patchRecord: vi.fn().mockResolvedValue(undefined),
  getPreviousDay: vi.fn().mockResolvedValue(null),
});

describe('medical handoff transport loading', () => {
  it('keeps the send pending without marking it sent while the transport loads', async () => {
    expect(transport.loaded).not.toHaveBeenCalled();
    transport.defer = true;
    const input = createInput();
    let settled = false;
    const sending = executeSendMedicalHandoff(input).then(outcome => {
      settled = true;
      return outcome;
    });
    try {
      await vi.waitFor(() => expect(transport.loaded).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      expect(input.patchRecord).not.toHaveBeenCalled();
      expect(transport.send).not.toHaveBeenCalled();
    } finally {
      transport.release();
    }
    expect((await sending).status).toBe('success');
    expect(transport.send).toHaveBeenCalledWith('synthetic-group', 'Entrega sintética');
    expect(input.patchRecord).toHaveBeenCalled();
  });

  it('reports a failed delivery and preserves sent metadata if the transport cannot load', async () => {
    vi.resetModules();
    vi.doMock('@/services/integrations/whatsapp/whatsappService', () => {
      throw new Error('Synthetic unavailable transport chunk');
    });
    try {
      const { executeSendMedicalHandoff: send } =
        await import('@/application/handoff/sendMedicalHandoffUseCase');
      const input = createInput();
      const outcome = await send(input);
      expect(outcome).toMatchObject({ status: 'failed', data: null });
      expect(input.patchRecord).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/services/integrations/whatsapp/whatsappService');
    }
  });
});
