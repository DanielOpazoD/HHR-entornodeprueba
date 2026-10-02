// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerSource = readFileSync(path.resolve('extension/extension-worker-status.js'), 'utf8');
const currentManifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
const renderWorker = (sendMessage: () => Promise<unknown>) => {
  const worker = { textContent: '', dataset: { state: '' } };
  vm.runInNewContext(workerSource, {
    chrome: { runtime: { getManifest: () => currentManifest, sendMessage } },
    document: { getElementById: () => worker },
    setTimeout,
    clearTimeout,
  });
  return worker;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

describe('extension version popup', () => {
  it.each([undefined, '9.7.1'])(
    'renders the loaded manifest version, including a future release %s',
    version => {
      const manifest = {
        ...JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')),
        ...(version ? { version } : {}),
      };
      const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
      const source = readFileSync(path.resolve('extension/extension-status.js'), 'utf8');
      const html = readFileSync(path.resolve('extension/extension-status.html'), 'utf8');
      const versionElement = { textContent: '' };
      const getElementById = vi.fn((id: string) =>
        id === 'extension-version' ? versionElement : null
      );
      const documentObject = { title: '', getElementById };

      vm.runInContext(
        source,
        vm.createContext({
          chrome: { runtime: { getManifest: () => manifest } },
          document: documentObject,
        }),
        { filename: 'extension-status.js' }
      );

      expect(manifest.action).toEqual({
        default_title: 'Ver versión del puente Eloísa → HHR',
        default_popup: 'extension-status.html',
      });
      expect(html).toContain('Versión que Chrome está usando');
      expect(html).toContain('Gestor documental incluido');
      expect(html).toContain('id="worker-status"');
      expect(html).toContain('src="extension-worker-status.js"');
      expect(background).toContain("'patient-document-manager'");
      expect(versionElement.textContent).toBe(`v${manifest.version}`);
      expect(documentObject.title).toBe(`Puente Eloísa → HHR · v${manifest.version}`);
    }
  );

  it('comprueba el worker y muestra una recuperación accionable si no responde', async () => {
    const connected = renderWorker(() =>
      Promise.resolve({
        version: currentManifest.version,
        runtimeGeneration: 'test-generation',
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(connected.dataset.state).toBe('ready');
    expect(connected.textContent).toContain('Worker operativo');

    const missing = renderWorker(() => Promise.reject(new Error('Receiving end does not exist')));
    await vi.advanceTimersByTimeAsync(0);
    expect(missing.dataset.state).toBe('error');
    expect(missing.textContent).toContain('chrome://extensions');

    const unregistered = renderWorker(() => {
      throw new Error('worker not registered');
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(unregistered.dataset.state).toBe('error');
  });

  it('waits exactly five seconds for a silent worker and ignores its late reply', async () => {
    let reply!: (value: unknown) => void;
    const response = new Promise<unknown>(resolve => {
      reply = resolve;
    });
    const sendMessage = vi.fn(() => response);
    const worker = renderWorker(sendMessage);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
    });
    expect(worker.dataset.state).toBe('');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.dataset.state).toBe('error');
    expect(worker.textContent).toContain('chrome://extensions');
    expect(vi.getTimerCount()).toBe(0);
    reply({ version: currentManifest.version, runtimeGeneration: 'late-generation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.dataset.state).toBe('error');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { version: 'obsolete-version', runtimeGeneration: 'old-generation' },
    { version: currentManifest.version },
  ])('rejects an unverifiable runtime context %j', async response => {
    const worker = renderWorker(() => Promise.resolve(response));
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.dataset.state).toBe('error');
    expect(worker.textContent).toContain('chrome://extensions');
  });
});
