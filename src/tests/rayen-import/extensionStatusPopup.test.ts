// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

describe('extension version popup', () => {
  it('is wired from the manifest and renders the loaded manifest version', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
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

    expect(manifest.version).toBe('0.48.11');
    expect(manifest.action).toEqual({
      default_title: 'Ver versión del puente Eloísa → HHR',
      default_popup: 'extension-status.html',
    });
    expect(html).toContain('Versión que Chrome está usando');
    expect(html).toContain('Gestor documental incluido');
    expect(background).toContain("'patient-document-manager'");
    expect(versionElement.textContent).toBe('v0.48.11');
    expect(documentObject.title).toBe('Puente Eloísa → HHR · v0.48.11');
  });
});
