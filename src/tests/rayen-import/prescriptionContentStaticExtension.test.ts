import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readExtensionSource = (fileName: string): string =>
  readFileSync(path.resolve('extension', fileName), 'utf8');

describe('extension clinical content static safeguards', () => {
  it('keeps clinical print retries usable and acknowledges writes before detached-panel exits', () => {
    const hospitalizedDocumentsSource = readExtensionSource('hhr-hospitalized-documents-center.js');
    const scoresSource = readExtensionSource('hhr-scores-center.js');
    const handoffSource = readExtensionSource('hhr-handoff-center.js');

    expect(hospitalizedDocumentsSource).toContain(
      "submit.textContent = 'Imprimir regímenes y BRADEN'"
    );
    expect(hospitalizedDocumentsSource).toContain("submit.textContent = 'Reintentar impresión'");

    const scoreAck = scoresSource.indexOf(
      'const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt)',
      scoresSource.indexOf('const renderScoresCenter')
    );
    const scoreDisconnect = scoresSource.indexOf('if (!panel.isConnected) return;', scoreAck);
    expect(scoreAck).toBeGreaterThan(-1);
    expect(scoreDisconnect).toBeGreaterThan(scoreAck);

    const handoffRequest = handoffSource.indexOf('type: runtimeMessages.HANDOFF_SAVE_REQUEST');
    const handoffAck = handoffSource.indexOf(
      'const acknowledged = await acknowledgeClinicalWrite(result.clinicalWriteReceipt)',
      handoffRequest
    );
    const handoffDisconnect = handoffSource.indexOf(
      'if (!root.isConnected) return;',
      handoffRequest
    );
    expect(handoffAck).toBeGreaterThan(handoffRequest);
    expect(handoffDisconnect).toBeGreaterThan(handoffAck);
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
    expect(connectionCenterSource).not.toMatch(/type=["']password["']/i);
  });
});
