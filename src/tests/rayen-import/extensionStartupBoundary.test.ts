import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync('extension/background-bootstrap.js', 'utf8');
type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;
const boot = (fails: boolean) => {
  const listeners = new Set<Listener>();
  const clinicalHandler = vi.fn();
  const importScripts = vi.fn((file: string) => {
    expect(file).toBe('background.js');
    expect(listeners.size).toBe(1);
    if (fails) throw new Error('synthetic-secret-in-module-error');
    listeners.add(clinicalHandler);
  });
  vm.runInNewContext(source, {
    URL,
    Set,
    console: { error: vi.fn() },
    importScripts,
    chrome: {
      runtime: {
        id: 'test-extension',
        getManifest: () => ({ version: '1.2.3' }),
        onMessage: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
    },
  });
  return { listeners, clinicalHandler, importScripts };
};

describe('extension startup failure boundary', () => {
  it('leaves only the regular router after successful synchronous startup', () => {
    const result = boot(false);
    expect([...result.listeners]).toEqual([result.clinicalHandler]);
    expect(result.importScripts).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://localhost:3001/census',
    'https://fichamedico.rayensalud.cl/dashboard',
    'https://hospitalizado.rayensalud.cl/',
    'chrome-extension://test-extension/extension-status.html',
  ])('reports a failed startup to %s without inventing clinical readiness', url => {
    const result = boot(true);
    const respond = vi.fn();
    [...result.listeners][0](
      { type: 'RAYEN_EXTENSION_HEALTH_REQUEST' },
      { id: 'test-extension', url },
      respond
    );
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        errorCode: 'EXTENSION_STARTUP_FAILED',
        version: '1.2.3',
      })
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain('synthetic-secret');
    expect(respond.mock.calls[0][0]).not.toHaveProperty('runtimeGeneration');
    expect(result.clinicalHandler).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other-extension', url: 'http://localhost:3001/' },
    { id: 'test-extension', url: 'https://fichamedico.rayensalud.cl.evil.test/' },
    { id: 'test-extension', url: 'chrome-extension://other-extension/status.html' },
    { id: 'test-extension', url: '' },
  ])('ignores untrusted senders: %j', sender => {
    const respond = vi.fn();
    [...boot(true).listeners][0]({ type: 'RAYEN_EXTENSION_HEALTH_REQUEST' }, sender, respond);
    expect(respond).not.toHaveBeenCalled();
  });

  it('rejects clinical commands without running an action after failed startup', () => {
    const result = boot(true);
    const respond = vi.fn();
    [...result.listeners][0](
      { type: 'RAYEN_SCORE_SAVE_REQUEST' },
      { id: 'test-extension', url: 'https://fichamedico.rayensalud.cl/' },
      respond
    );
    expect(respond.mock.calls[0][0].ok).toBe(false);
    expect(result.clinicalHandler).not.toHaveBeenCalled();
  });
});
