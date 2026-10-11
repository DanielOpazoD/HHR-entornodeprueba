// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const read = (file: string) => readFileSync(path.resolve('extension', file), 'utf8');
const origins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://testinghhr.netlify.app',
  'https://hhr-entorno-prueba.netlify.app',
];
const rejectedOrigins = [
  'http://hhr-entorno-prueba.netlify.app',
  'https://hhr-entorno-prueba.netlify.app:8443',
  'https://hhr-entorno-prueba.netlify.app.evil.example',
  'https://deploy-preview-1--hhr-entorno-prueba.netlify.app',
  'https://unrelated.netlify.app',
  'null',
];
const routes = [
  [
    'content-hhr-epicrisis.js',
    'HHR_RAYEN_EPICRISIS_DOWNLOAD_REQUEST',
    'RAYEN_NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST',
  ],
  [
    'content-hhr-patient-flow.js',
    'HHR_RAYEN_PATIENT_FLOW_REQUEST',
    'RAYEN_PATIENT_FLOW_REPORT_REQUEST',
  ],
  [
    'content-hhr-patient-documents.js',
    'HHR_RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST',
    'RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST',
  ],
  [
    'content-hhr-statistical-discharge.js',
    'HHR_RAYEN_STATISTICAL_DISCHARGE_DOWNLOAD_REQUEST',
    'RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST',
  ],
  [
    'content-hhr-statistical-evidence.js',
    'HHR_RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST',
    'RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST',
  ],
  ['content-hhr-syslab.js', 'HHR_RAYEN_SYSLAB_STATUS_REQUEST', 'RAYEN_SYSLAB_STATUS_REQUEST'],
];

function harness(file: string, origin: string) {
  const listeners: Array<(event: object) => void> = [];
  const sendMessage = vi.fn(async () => ({ ok: true }));
  const postMessage = vi.fn();
  const window = {
    location: { origin },
    addEventListener: (_type: string, listener: (event: object) => void) =>
      listeners.push(listener),
    postMessage,
  };
  const context = vm.createContext({
    window,
    chrome: { runtime: { id: 'fixture', sendMessage, onMessage: { addListener: vi.fn() } } },
  });
  vm.runInContext(read('message-contract.js'), context);
  vm.runInContext(read(file), context);
  const dispatch = (type: string, eventOrigin = origin, source: object = window) =>
    listeners.forEach(listener =>
      listener({
        source,
        origin: eventOrigin,
        data: { type, reqId: 'fixture-request', encId: '123' },
      })
    );
  return { listeners, sendMessage, postMessage, dispatch };
}

describe('published HHR origin contract', () => {
  it('declares exactly the supported HHR sites for injection and host access', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const hhrScripts = manifest.content_scripts.filter((entry: { js: string[] }) =>
      entry.js.includes('content-hhr.js')
    );
    expect(hhrScripts).toHaveLength(1);
    expect(hhrScripts[0].matches).toEqual(origins.map(origin => `${origin}/*`));
    for (const match of hhrScripts[0].matches) expect(manifest.host_permissions).toContain(match);
  });

  describe.each(routes)('%s', (file, pageType, runtimeType) => {
    it.each(origins)('routes valid same-window messages on %s', async origin => {
      const bridge = harness(file, origin);
      expect(bridge.listeners).toHaveLength(1);
      bridge.dispatch(pageType, 'https://unrelated.netlify.app');
      bridge.dispatch(pageType, origin, {});
      expect(bridge.sendMessage).not.toHaveBeenCalled();
      bridge.dispatch(pageType);
      await vi.waitFor(() => expect(bridge.sendMessage).toHaveBeenCalledOnce());
      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: runtimeType })
      );
      await vi.waitFor(() => expect(bridge.postMessage).toHaveBeenCalledOnce());
      expect(bridge.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ reqId: 'fixture-request' }),
        origin
      );
    });

    it.each(rejectedOrigins)('does not install on %s', origin => {
      expect(harness(file, origin).listeners).toHaveLength(0);
    });
  });
});
