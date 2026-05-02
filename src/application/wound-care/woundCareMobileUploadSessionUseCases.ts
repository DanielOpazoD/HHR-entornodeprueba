import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  defaultWoundCareMobileUploadSessionPort,
  type WoundCareMobileUploadSessionPort,
} from '@/application/ports/woundCarePort';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';
import type { EpisodeContext } from './woundCareUseCaseHelpers';

const SESSION_TTL_MS = 60 * 60 * 1000;

const defaultGenerateSessionId = (): string =>
  `wcu_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

export interface WoundCareMobileUploadSessionDeps {
  sessionPort?: WoundCareMobileUploadSessionPort;
  generateSessionId?: () => string;
}

export const executeCreateWoundCareMobileUploadSession = async (
  input: {
    hospitalId: string;
    episodeContext: EpisodeContext;
    actor: WoundCareAuditActor;
  },
  deps: WoundCareMobileUploadSessionDeps = {}
): Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>> => {
  const sessionPort = deps.sessionPort ?? defaultWoundCareMobileUploadSessionPort;
  const generateSessionId = deps.generateSessionId ?? defaultGenerateSessionId;
  const now = new Date();
  const session: WoundCareMobileUploadSession = {
    sessionId: generateSessionId(),
    hospitalId: input.hospitalId,
    episodeKey: input.episodeContext.episodeKey,
    patientRut: input.episodeContext.patientRut,
    patientName: input.episodeContext.patientName,
    createdBy: input.actor,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    scope: 'wound_care_upload_only',
  };

  try {
    const saved = await sessionPort.create(session, input.hospitalId);
    return createApplicationSuccess(saved);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message:
          error instanceof Error ? error.message : 'No se pudo generar el acceso móvil por QR.',
      },
    ]);
  }
};

export const executeValidateWoundCareMobileUploadSession = async (
  sessionId: string,
  deps: Pick<WoundCareMobileUploadSessionDeps, 'sessionPort'> = {}
): Promise<ApplicationOutcome<WoundCareMobileUploadSession | null>> => {
  const sessionPort = deps.sessionPort ?? defaultWoundCareMobileUploadSessionPort;

  try {
    const session = await sessionPort.getById(sessionId);
    if (!session) {
      return createApplicationFailed(null, [
        { kind: 'validation', message: 'El acceso móvil no existe.' },
      ]);
    }

    if (session.revokedAt) {
      return createApplicationFailed(null, [
        { kind: 'validation', message: 'El acceso móvil fue revocado.' },
      ]);
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return createApplicationFailed(null, [
        { kind: 'validation', message: 'El acceso móvil está vencido.' },
      ]);
    }

    if (session.scope !== 'wound_care_upload_only') {
      return createApplicationFailed(null, [
        { kind: 'validation', message: 'El acceso móvil no permite esta operación.' },
      ]);
    }

    return createApplicationSuccess(session);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo validar el acceso móvil.',
      },
    ]);
  }
};

export const executeRevokeWoundCareMobileUploadSession = async (
  input: { sessionId: string; actor: WoundCareAuditActor; hospitalId: string },
  deps: Pick<WoundCareMobileUploadSessionDeps, 'sessionPort'> = {}
): Promise<ApplicationOutcome<null>> => {
  const sessionPort = deps.sessionPort ?? defaultWoundCareMobileUploadSessionPort;

  try {
    await sessionPort.revoke(
      input.sessionId,
      {
        revokedAt: new Date().toISOString(),
        revokedBy: input.actor,
      },
      input.hospitalId
    );
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo revocar el acceso móvil.',
      },
    ]);
  }
};
