import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClinicalAIProviderRoutingPanel } from '@/features/admin/components/ClinicalAIProviderRoutingPanel';
import {
  createDefaultClinicalAIProviderRoutingDocument,
  type ClinicalAIProviderRoutingDocument,
} from '@/shared/ai/clinicalAIProviderRouting';

const setRoutingMock = vi.fn();
const saveMock = vi.fn();
const notifyMock = vi.fn();
const getStatusesMock = vi.fn();
const testProviderMock = vi.fn();
let routingMock: ClinicalAIProviderRoutingDocument;

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'admin@hospital.cl' },
  }),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: notifyMock,
  }),
}));

vi.mock('@/features/admin/hooks/useClinicalAIProviderRouting', () => ({
  useClinicalAIProviderRouting: () => ({
    routing: routingMock,
    setRouting: setRoutingMock,
    loading: false,
    saving: false,
    error: null,
    save: saveMock,
  }),
}));

vi.mock('@/services/admin/clinicalAIProviderStatusService', () => ({
  getClinicalAIProviderStatuses: () => getStatusesMock(),
  testClinicalAIProvider: (...args: unknown[]) => testProviderMock(...args),
}));

describe('ClinicalAIProviderRoutingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routingMock = createDefaultClinicalAIProviderRoutingDocument();
    getStatusesMock.mockResolvedValue([
      { provider: 'gemini', configured: true, model: 'gemini-3-flash-preview' },
      { provider: 'deepseek', configured: true, model: 'deepseek-chat' },
      { provider: 'openai', configured: false, model: 'gpt-4o-mini' },
    ]);
    saveMock.mockResolvedValue(undefined);
    testProviderMock.mockResolvedValue({
      ok: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      message: 'Provider test succeeded',
    });
  });

  it('lists only configured Netlify providers for action routing', async () => {
    render(<ClinicalAIProviderRoutingPanel />);

    await waitFor(() => {
      expect(screen.getAllByRole('option', { name: 'DeepSeek' })).toHaveLength(4);
    });

    expect(screen.getAllByRole('option', { name: 'Gemini' })).toHaveLength(4);
    expect(screen.queryByRole('option', { name: 'OpenAI' })).not.toBeInTheDocument();
  });

  it('updates the selected provider for an action and saves the routing', async () => {
    const user = userEvent.setup();
    render(<ClinicalAIProviderRoutingPanel />);

    const [firstProviderSelect] = await screen.findAllByRole('combobox');
    await user.selectOptions(firstProviderSelect, 'deepseek');

    expect(setRoutingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({
          clinical_document_import: expect.objectContaining({
            provider: 'deepseek',
          }),
        }),
      })
    );

    await user.click(screen.getByRole('button', { name: /guardar/i }));
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Configuración IA guardada' })
    );
  });

  it('tests the selected provider without exposing API keys', async () => {
    const user = userEvent.setup();
    routingMock = {
      ...createDefaultClinicalAIProviderRoutingDocument(),
      actions: {
        ...createDefaultClinicalAIProviderRoutingDocument().actions,
        clinical_document_import: {
          enabled: true,
          provider: 'deepseek',
          model: null,
        },
      },
    };

    render(<ClinicalAIProviderRoutingPanel />);

    await screen.findAllByRole('combobox');
    const [firstTestButton] = screen.getAllByRole('button', { name: /probar/i });
    await user.click(firstTestButton);

    expect(testProviderMock).toHaveBeenCalledWith({
      action: 'clinical_document_import',
      provider: 'deepseek',
      model: null,
    });
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        title: 'Proveedor IA operativo',
      })
    );
  });
});
