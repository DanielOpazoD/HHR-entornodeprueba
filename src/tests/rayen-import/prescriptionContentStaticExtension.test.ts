// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readExtensionSource = (fileName: string): string =>
  readFileSync(path.resolve('extension', fileName), 'utf8');

describe('extension clinical content static safeguards', () => {
  it('keeps hospitalized indications print retries usable', () => {
    const source = readExtensionSource('hhr-hospitalized-documents-center.js');
    expect(source).toContain("submit.textContent = 'Reintentar impresión'");
  });

  it('keeps credentials on the official Rayen page and exposes session controls in Centro HHR', () => {
    const contentSource = readExtensionSource('content-prescription-print.js');
    const connectionCenterSource = readExtensionSource('hhr-connection-center-runtime.js');

    expect(connectionCenterSource).toContain('type: runtimeMessages.GC_CONNECT_REQUEST');
    expect(connectionCenterSource).toContain('type: runtimeMessages.GC_DISCONNECT_REQUEST');
    expect(connectionCenterSource).toContain(
      'La contraseña se ingresa únicamente en la página oficial de Rayen'
    );
    expect(contentSource).toContain("openCenterModule('connection'");
    expect(contentSource).toContain('hhr-ops-connection-dot');
    expect(contentSource).toContain("message.type !== 'RAYEN_EXTENSION_HEALTH_PUSH'");
    expect(contentSource).toContain('refreshOperationsConnectionBadge(bar, true, message.report)');
    expect(connectionCenterSource).not.toMatch(/type=["']password["']/i);
  });
});
