import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMessageTemplates = vi.fn();
const mockSaveMessageTemplates = vi.fn();
const mockConfigQuery = vi.fn();

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  getMessageTemplates: (...args: unknown[]) => mockGetMessageTemplates(...args),
  saveMessageTemplates: (...args: unknown[]) => mockSaveMessageTemplates(...args),
}));

vi.mock('@/hooks/useWhatsAppQuery', () => ({
  useWhatsAppConfigQuery: () => mockConfigQuery(),
  useWhatsAppHealthQuery: () => ({ data: 'connected', isLoading: false, refetch: vi.fn() }),
  useWhatsAppGroupsQuery: () => ({ data: [], isLoading: false }),
  useUpdateWhatsAppConfigMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));

import { MessageTemplatesEditor } from '@/features/whatsapp/components/MessageTemplatesEditor';
import { WhatsAppConfigView } from '@/features/whatsapp/components/WhatsAppConfigView';

const storedTemplate = {
  id: 'handoff-1',
  name: 'Entrega configurada',
  type: 'handoff',
  content: 'Entrega {{date}}',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageTemplatesEditor failures', () => {
  it('offers a retry, not editable defaults, when the stored templates cannot be read', async () => {
    mockGetMessageTemplates
      .mockRejectedValueOnce(new Error('No se pudieron leer las plantillas de WhatsApp.'))
      .mockResolvedValueOnce([storedTemplate]);

    render(<MessageTemplatesEditor />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron leer las plantillas'
    );
    expect(screen.queryByText('Nueva')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Entrega configurada')).toBeInTheDocument();
    expect(mockSaveMessageTemplates).not.toHaveBeenCalled();
  });

  it('keeps the stored list and says so when a save fails', async () => {
    mockGetMessageTemplates.mockResolvedValue([storedTemplate]);
    mockSaveMessageTemplates.mockRejectedValue(
      new Error('No se pudieron guardar las plantillas de WhatsApp.')
    );

    render(<MessageTemplatesEditor />);
    fireEvent.click(await screen.findByText('Nueva'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron guardar las plantillas'
    );
    expect(screen.queryByText('Nueva Plantilla')).not.toBeInTheDocument();
    expect(screen.getByText('Entrega configurada')).toBeInTheDocument();
  });
});

describe('WhatsAppConfigView failures', () => {
  it('offers a retry instead of a form prefilled with defaults when the config cannot be read', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockConfigQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('No se pudo leer la configuración de WhatsApp.'),
      refetch,
    });

    render(<WhatsAppConfigView />);

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer la configuración');
    expect(screen.queryByText('Guardar Configuración')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refetch).toHaveBeenCalled();
  });
});
