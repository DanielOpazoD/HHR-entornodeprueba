// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../extension/hhr-connection-repair-controls.js';
import '../../../extension/hhr-connection-action-model.js';
import '../../../extension/hhr-connection-presentation.js';
import '../../../extension/hhr-connection-center-runtime.js';

type Message = { type?: string };
type Runtime = {
  renderConnectionCenter: (root: HTMLElement, encId: string) => void;
  dispose: () => void;
};
type RuntimeOwner = { create: (dependencies: Record<string, unknown>) => Runtime };

const owner = () =>
  (globalThis as unknown as { HhrConnectionCenterRuntime: RuntimeOwner })
    .HhrConnectionCenterRuntime;
const messages = {
  EXTENSION_HEALTH_REQUEST: 'EXTENSION_HEALTH_REQUEST',
  CONNECTION_REPAIR_REQUEST: 'CONNECTION_REPAIR_REQUEST',
  GC_CONNECT_REQUEST: 'GC_CONNECT_REQUEST',
  GC_DISCONNECT_REQUEST: 'GC_DISCONNECT_REQUEST',
};
const report = (status: 'ready' | 'missing', name: string) => ({
  version: '0.48.10',
  capabilities: ['clean-connection-repair'],
  fichaMedico: {
    status,
    reason: status === 'ready' ? 'connected' : 'session_expired',
    identity: { fullName: name, role: 'Médico' },
  },
  gestionCamas: {
    status,
    reason: status === 'ready' ? 'connected' : 'session_expired',
    remainingSeconds: 3_600,
    message: status === 'ready' ? '' : 'Inicia sesión para continuar.',
  },
  hhr: { status: 'ready', reason: 'connected', message: 'HHR enlazado.' },
});

describe('Centro HHR directed repair report', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps the repaired tabs visible instead of reloading stale global health', async () => {
    const expired = report('missing', 'Sesión anterior');
    const repaired = report('ready', 'Sesión reparada');
    const sendMessage = vi.fn(async (message: Message) =>
      message.type === messages.CONNECTION_REPAIR_REQUEST ? { ok: true, report: repaired } : expired
    );
    const runtime = owner().create({
      documentRef: document,
      windowRef: window,
      runtimeMessages: messages,
      sendMessage,
      setLiveRegion: (element: HTMLElement, text: string) => {
        element.textContent = text;
      },
      connectionInitials: () => 'SR',
      connectionTimeLabel: () => 'Vence en 1 h',
      handoffLabelForIdentity: () => 'Entrega médica',
      operationsBarId: 'operations-bar',
    });
    const root = document.createElement('div');
    root.dataset.activeModule = 'connection';
    root.innerHTML = '<main class="hhr-center-main"></main>';
    document.body.appendChild(root);
    runtime.renderConnectionCenter(root, '141121');
    await vi.waitFor(() => expect(root.querySelector('.hhr-connection-repair')).toBeTruthy());

    root.querySelector<HTMLButtonElement>('.hhr-connection-repair')?.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.hhr-connection-ficha .hhr-connection-status')?.textContent).toBe(
        'Conectado'
      )
    );

    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message.type === messages.EXTENSION_HEALTH_REQUEST
      )
    ).toHaveLength(1);
    expect(
      root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue
    ).toBe('Sesión reparada');
    runtime.dispose();
  });
});
