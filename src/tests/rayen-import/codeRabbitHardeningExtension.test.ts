// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readExtension = (file: string): string =>
  readFileSync(path.resolve('extension', file), 'utf8');

const backgroundSource = readExtension('background.js');
const contentSource = readExtension('content-prescription-print.js');
const fichaSource = readExtension('inject-fichamedico.js');
const readmeSource = readExtension('README.md');

describe('CodeRabbit clinical integration hardening', () => {
  it('uses the short health budget for both tab and backend session verification', () => {
    expect(backgroundSource).toContain('verificationTimeoutMs: HEALTH_PROBE_TIMEOUT_MS');
    expect(backgroundSource).toContain('tabTimeoutMs: HEALTH_PROBE_TIMEOUT_MS');
    expect(backgroundSource).toContain(
      'verifyGestionCamasSession(record, HEALTH_PROBE_TIMEOUT_MS)'
    );
  });

  it('separates expired and forbidden sessions and only forwards approved egreso metadata', () => {
    expect(backgroundSource).toContain('if (response.status === 401)');
    expect(backgroundSource).toContain("if (response.status === 403) return 'forbidden'");
    expect(backgroundSource).toContain('GESTION_CAMAS_EGRESO_METADATA_FIELDS');
    expect(backgroundSource).not.toContain('GESTION_CAMAS_PHI_FIELDS');
    const picker = backgroundSource.slice(
      backgroundSource.indexOf('const pickGestionCamasEncounterMetadata'),
      backgroundSource.indexOf('const handleEgresoLookup')
    );
    expect(picker).not.toContain('Object.keys');
  });

  it('fails the clinical panel closed when daily treatment validation is unavailable', () => {
    expect(backgroundSource).toContain(
      "{ label: 'validación diaria del tratamiento', result: validationResult }"
    );
    expect(backgroundSource).toContain('validationSource && validationSource.error');
  });

  it('requires server claims for medical and nursing handoff access', () => {
    expect(backgroundSource).not.toContain("handoffKind === 'medical' ? { claims: [] }");
    expect(backgroundSource).not.toContain("handoffKind === 'medical' || hasFichaClaim");
    expect(backgroundSource).toContain("hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno')");
  });

  it('discards stale identity refreshes and compares against the previous binding', () => {
    expect(fichaSource).toContain('revision !== sessionBindingRevision');
    expect(fichaSource).toContain('const previousAuth = capturedAuth');
    expect(fichaSource).toContain('previousAuth === sessionToken');
  });

  it('restores reconnect after forgetting a session and documents retained metadata', () => {
    const forgetHandler = contentSource.slice(
      contentSource.indexOf("forget.addEventListener('click'"),
      contentSource.indexOf(
        'void load();',
        contentSource.indexOf("forget.addEventListener('click'")
      )
    );
    expect(forgetHandler.indexOf('connect.disabled = false')).toBeGreaterThan(
      forgetHandler.indexOf('await sendMessage')
    );
    expect(readmeSource).toContain('metadatos mínimos de sesión');
    expect(readmeSource).toContain('identidad derivada');
  });
});
