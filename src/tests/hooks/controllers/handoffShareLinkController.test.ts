// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveHandoffShareLinkPlan } from '@/hooks/controllers/handoffShareLinkController';

describe('handoffShareLinkController', () => {
  it('returns a copy plan for a valid handoff URL', () => {
    expect(
      resolveHandoffShareLinkPlan({
        scope: 'upc',
        result: {
          status: 'success',
          data: {
            handoffUrl: 'https://hhr.test/signature?scope=upc',
          },
          issues: [],
        },
      })
    ).toEqual({
      kind: 'copy',
      text: 'https://hhr.test/signature?scope=upc',
      successMessage: 'Enlace copiado',
      successDescription: 'El link para firma médica de UPC ha sido copiado al portapapeles.',
    });
  });

  it('returns a notify plan for permission failures', () => {
    expect(
      resolveHandoffShareLinkPlan({
        scope: 'all',
        result: {
          status: 'failed',
          data: null,
          issues: [
            {
              kind: 'permission',
              message: 'El médico especialista solo puede editar la entrega médica del día actual.',
            },
          ],
        },
      })
    ).toEqual({
      kind: 'notify',
      message: 'El médico especialista solo puede editar la entrega médica del día actual.',
    });
  });

  it('prefers userSafeMessage over raw issues', () => {
    expect(
      resolveHandoffShareLinkPlan({
        scope: 'all',
        result: {
          status: 'failed',
          data: null,
          userSafeMessage: 'La firma médica no está disponible para este perfil.',
          issues: [{ kind: 'permission', message: 'raw permission failure' }],
        },
      })
    ).toEqual({
      kind: 'notify',
      message: 'La firma médica no está disponible para este perfil.',
    });
  });

  it('uses the E2E fallback only when there is no domain feedback', () => {
    expect(
      resolveHandoffShareLinkPlan({
        scope: 'all',
        e2eFallbackUrl: 'https://hhr.test/admin?mode=signature&scope=all&token=e2e-token',
        result: {
          status: 'failed',
          data: null,
          issues: [],
        },
      })
    ).toEqual({
      kind: 'copy',
      text: 'https://hhr.test/admin?mode=signature&scope=all&token=e2e-token',
      successMessage: 'Enlace copiado',
      successDescription:
        'Se generó un enlace de firma médica en modo E2E para continuar la validación.',
    });
  });
});
