// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cada puente `window.postMessage` de la extensión (MAIN e ISOLATED) es la frontera entre la
 * página y el service worker. Validar solo `event.source === window` deja pasar cualquier
 * mensaje de la misma ventana sin importar su origen; desde ahora todos exigen además
 * `event.origin === window.location.origin`. Y la lectura de diagnósticos ya no sustituye el
 * identificador del profesional por uno fijo.
 */

const extensionDir = path.resolve('extension');
const read = (file: string) => fs.readFileSync(path.join(extensionDir, file), 'utf8');

const pageBridges = fs
  .readdirSync(extensionDir)
  .filter(file => /^(content-|inject-)[a-z-]+\.js$/.test(file))
  .filter(file => read(file).includes("addEventListener('message'"));

describe('extension page bridges validate the message origin', () => {
  it('covers every content and inject script that listens to page messages', () => {
    expect(pageBridges.length).toBeGreaterThanOrEqual(8);
  });

  it.each(pageBridges)('%s never accepts a page message on source alone', file => {
    const source = read(file);
    expect(source).not.toMatch(/if \(event\.source !== window\) return;/);
    const guardsOrigin =
      /event\.origin !== window\.location\.origin/.test(source) ||
      /event\.origin === window\.location\.origin/.test(source);
    expect(guardsOrigin).toBe(true);
  });
});

describe('diagnosis reads fail closed without the practitioner id', () => {
  it('does not fall back to a hardcoded healthCarePractitionerId', () => {
    const inject = read('inject-fichamedico.js');
    expect(inject).not.toMatch(/\|\|\s*'7941'/);
    expect(inject).toContain('no expone el identificador del profesional');
  });
});
