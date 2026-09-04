// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../extension/hhr-connection-action-model.js';

type ActionModel = {
  derive: (report: unknown) => Record<string, unknown>;
  sourceLabel: (source: unknown) => string;
};

type SourceFixture = {
  status: string;
  reason?: string;
  message: string;
  remainingSeconds?: number | null;
  connectionSource?: string;
};

const model = () =>
  (globalThis as unknown as { HhrConnectionActionModel: ActionModel }).HhrConnectionActionModel;
const ready: SourceFixture = { status: 'ready', reason: 'connected', message: 'Vigente.' };
const report = (
  ficha: SourceFixture = ready,
  camas: SourceFixture = ready,
  capabilities = ['clean-connection-repair']
) => ({
  version: '0.48.12',
  capabilities,
  fichaMedico: ficha,
  gestionCamas: camas,
  hhr: ready,
});

describe('HhrConnectionActionModel', () => {
  it('mantiene una sola acción y no ofrece controles con todo vigente', () => {
    expect(model().derive(report())).toMatchObject({
      tone: 'ready',
      summary: 'Conectado',
      action: 'none',
    });
  });

  it('distingue conexión dirigida, reparación limpia y fallback compatible', () => {
    expect(
      model().derive(
        report(ready, { status: 'missing', reason: 'tab_missing', message: 'No abierta.' })
      )
    ).toMatchObject({ action: 'connect-gc', actionLabel: 'Abrir Gestión de Camas' });
    expect(
      model().derive(report(ready, { status: 'missing', message: 'No abierta.' }, []))
    ).toMatchObject({ action: 'connect-gc', actionLabel: 'Abrir Gestión de Camas' });
    expect(
      model().derive(
        report(ready, {
          status: 'stale',
          reason: 'session_unverified',
          message: 'Sin verificar.',
          connectionSource: 'session',
        })
      )
    ).toMatchObject({
      action: 'connect-gc',
      actionLabel: 'Renovar Gestión de Camas',
      renewGestionCamas: true,
    });
    expect(
      model().derive(
        report({ status: 'stale', reason: 'outdated_tab', message: 'Antigua.' }, ready)
      )
    ).toMatchObject({ action: 'repair', actionLabel: 'Abrir conexión limpia' });
    expect(
      model().derive(
        report({ status: 'stale', reason: 'outdated_tab', message: 'Antigua.' }, ready, [])
      )
    ).toMatchObject({ action: 'refresh', actionLabel: 'Reintentar comprobación' });
  });

  it('prioriza una Ficha próxima a vencer y expone motivos legibles', () => {
    expect(
      model().derive(
        report({ ...ready, remainingSeconds: 120 }, { ...ready, remainingSeconds: 120 })
      )
    ).toMatchObject({ action: 'repair', summary: 'Ficha Médico por vencer' });
    expect(
      model().derive(
        report(
          { ...ready, remainingSeconds: 120 },
          { status: 'missing', reason: 'tab_missing', message: 'No abierta.' }
        )
      )
    ).toMatchObject({ action: 'repair', summary: 'Ficha Médico por vencer' });
    expect(model().sourceLabel({ status: 'stale', reason: 'relay_disconnected' })).toBe(
      'Relé desconectado'
    );
  });

  it('no interpreta una vigencia desconocida como una sesión vencida', () => {
    expect(
      model().derive(
        report({ ...ready, remainingSeconds: null }, { ...ready, remainingSeconds: null })
      )
    ).toMatchObject({ action: 'none', summary: 'Conectado' });
  });
});
