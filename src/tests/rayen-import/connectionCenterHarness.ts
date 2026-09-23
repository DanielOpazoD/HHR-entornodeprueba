import '../../../extension/hhr-connection-repair-controls.js';
import '../../../extension/hhr-connection-action-model.js';
import '../../../extension/hhr-connection-presentation.js';
import '../../../extension/hhr-connection-center-runtime.js';

export type Message = { type?: string; renew?: boolean };
type Runtime = {
  renderConnectionCenter: (root: HTMLElement, encId: string) => void;
  refreshOperationsConnectionBadge: (
    bar: HTMLElement,
    force?: boolean,
    report?: unknown
  ) => Promise<unknown>;
  invalidateConnectionState: (root: HTMLElement) => void;
  dispose: () => void;
};
type RuntimeOwner = { create: (dependencies: Record<string, unknown>) => Runtime };

export const owner = () =>
  (globalThis as unknown as { HhrConnectionCenterRuntime: RuntimeOwner })
    .HhrConnectionCenterRuntime;

export const messages = {
  EXTENSION_HEALTH_REQUEST: 'EXTENSION_HEALTH_REQUEST',
  CONNECTION_REPAIR_REQUEST: 'CONNECTION_REPAIR_REQUEST',
  GC_CONNECT_REQUEST: 'GC_CONNECT_REQUEST',
  GC_DISCONNECT_REQUEST: 'GC_DISCONNECT_REQUEST',
};

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

export const report = (fichaStatus = 'ready', camasStatus = 'ready', name = 'Ana Riroroko') => ({
  version: '0.48.10',
  runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  capabilities: ['clean-connection-repair'],
  fichaMedico: {
    status: fichaStatus,
    reason: fichaStatus === 'ready' ? 'connected' : 'session_expired',
    identity: { fullName: name, role: 'Médico', practitionerRoleId: '10' },
  },
  gestionCamas: {
    status: camasStatus,
    reason: camasStatus === 'ready' ? 'connected' : 'session_expired',
    identity: { username: 'ana.riroroko' },
    remainingSeconds: 3_600,
    connectionSource: 'session',
    message: camasStatus === 'ready' ? '' : 'Inicia sesión para continuar.',
  },
  hhr: {
    status: 'ready',
    reason: 'connected',
    message: 'HHR enlazado.',
  },
});

export const makeRoot = () => {
  const root = document.createElement('div');
  root.dataset.activeModule = 'connection';
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

export const makeBar = () => {
  const bar = document.createElement('aside') as HTMLElement & { __hhrRoot?: ShadowRoot };
  bar.id = 'operations-bar';
  const shadow = bar.attachShadow({ mode: 'open' });
  bar.__hhrRoot = shadow;
  shadow.innerHTML = `
    <button class="hhr-ops-handoff"></button>
    <button class="hhr-ops-session is-degraded">
      <span class="hhr-ops-avatar">HHR</span>
      <span class="session-name">Conexiones</span>
      <span class="session-state">Comprobando…</span>
    </button>
  `;
  document.body.appendChild(bar);
  return bar;
};

export const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

export const makeRuntime = (sendMessage: (message: Message) => Promise<unknown>) =>
  owner().create({
    documentRef: document,
    windowRef: window,
    runtimeMessages: messages,
    sendMessage,
    setLiveRegion: (element: HTMLElement, text: string, state = '') => {
      element.textContent = text;
      element.dataset.state = state;
    },
    connectionInitials: (name: string) =>
      name
        .split(/\s+/)
        .map(part => part[0])
        .join(''),
    connectionTimeLabel: () => 'Vence en 1 h',
    handoffLabelForIdentity: () => 'Entrega médica',
    operationsBarId: 'operations-bar',
  });
