// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const read = (file: string) => readFileSync(path.resolve('extension', file), 'utf8');
const localOrigins = ['localhost', '127.0.0.1'].flatMap(host =>
  Array.from({ length: 21 }, (_, index) => `http://${host}:${3000 + index}`)
);
const publishedOrigins = [
  'https://hhr-hospitalizados.app',
  'https://testinghhr.netlify.app',
  'https://hhr-entorno-prueba.netlify.app',
];
const deploymentOrigins = ['testinghhr', 'hhr-entorno-prueba'].flatMap(site => [
  `https://deploy-preview-992--${site}.netlify.app`,
  `https://feature-origins--${site}.netlify.app`,
  `https://0123456789abcdef01234567--${site}.netlify.app`,
]);
const origins = [...localOrigins, ...publishedOrigins, ...deploymentOrigins];
const rejectedOrigins = [
  'http://localhost:2999',
  'http://localhost:3021',
  'http://localhost:4000',
  'http://127.0.0.1:2999',
  'http://127.0.0.1:3021',
  'http://localhost.example:3000',
  'http://hhr-hospitalizados.app',
  'https://hhr-hospitalizados.app.evil.example',
  'https://hhr-hospitalizados.app:8443',
  'https://user@hhr-hospitalizados.app',
  'http://hhr-entorno-prueba.netlify.app',
  'https://hhr-entorno-prueba.netlify.app:8443',
  'https://hhr-entorno-prueba.netlify.app.evil.example',
  'https://deploy-preview-1--unrelated.netlify.app',
  'https://deploy-preview-1--hhr-entorno-prueba-evil.netlify.app',
  'https://deploy-preview-1--hhr-entorno-prueba.netlify.app.evil.example',
  'http://deploy-preview-1--testinghhr.netlify.app',
  'https://unrelated.netlify.app',
  'http://localhost:3000\n',
  'https://deploy-preview-1--testinghhr.netlify.app\n',
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
  vm.runInContext(read('hhr-origin-policy.js'), context);
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
  it('does not probe unrelated Netlify tabs as HHR', async () => {
    const context = vm.createContext({});
    vm.runInContext(read('hhr-origin-policy.js'), context);
    vm.runInContext(read('health-check.js'), context);
    const createProbe = vm.runInContext('HhrExtensionHealth.createHhrProbe', context);
    const isTargetTab = vm.runInContext('tab => HhrAppOrigins.matchesUrl(tab.url)', context);
    const sendMessage = vi.fn(async () => ({ ready: true }));
    const probe = createProbe({
      chromeApi: {
        tabs: {
          query: async () => [
            { id: 1, url: 'https://deploy-preview-992--testinghhr.netlify.app/census' },
            { id: 2, url: 'https://unrelated.netlify.app/census' },
          ],
          sendMessage,
        },
      },
      withTimeout: (promise: Promise<unknown>) => promise,
      timeoutMs: 100,
      matches: ['https://*.netlify.app/*'],
      isTargetTab,
    });
    await expect(probe({ runtimeGeneration: 'fixture' })).resolves.toMatchObject({
      status: 'ready',
    });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(1, expect.any(Object));
  });

  it('declares exactly the supported HHR sites for injection and host access', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const hhrScripts = manifest.content_scripts.filter((entry: { js: string[] }) =>
      entry.js.includes('content-hhr.js')
    );
    expect(hhrScripts).toHaveLength(1);
    expect(hhrScripts[0].matches).toEqual([
      ...localOrigins.map(origin => `${origin}/*`),
      ...publishedOrigins.map(origin => `${origin}/*`),
      'https://*.netlify.app/*',
    ]);
    expect(hhrScripts[0].js.indexOf('hhr-origin-policy.js')).toBeLessThan(
      hhrScripts[0].js.indexOf('content-hhr.js')
    );
    for (const match of hhrScripts[0].matches) expect(manifest.host_permissions).toContain(match);
  });

  describe.each([
    'content-hhr.js',
    'content-hhr-sync-bundle.js',
    'content-hhr-connection-repair.js',
  ])('%s shared relays', file => {
    it.each(rejectedOrigins)('does not install on %s', origin => {
      expect(harness(file, origin).listeners).toHaveLength(0);
    });
  });

  it('keeps wildcard candidates restricted to the approved Netlify projects', () => {
    const context = vm.createContext({});
    vm.runInContext(read('hhr-origin-policy.js'), context);
    const matches = vm.runInContext('HhrAppOrigins.matchesPattern', context);
    for (const origin of deploymentOrigins)
      expect(matches(`${origin}/census`, 'https://*.netlify.app/*')).toBe(true);
    for (const origin of [...rejectedOrigins, 'https://hhr-hospitalizados.app'])
      expect(matches(`${origin}/census`, 'https://*.netlify.app/*')).toBe(false);
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
