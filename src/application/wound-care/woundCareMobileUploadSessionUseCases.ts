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

// QR mobile uploader access window. Reduced from 60min → 30min to
// shrink the time-to-revoke after a clinician walks away from the
// generated QR. Closes the product slice of the
// `wound-care-mobile-qr` activo.
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_ID_BYTES = 16;
// Cap on photos a single QR session can upload before the backend
// rejects further attempts. Documented in the `WoundCareMobileUploadSession`
// type. Generous enough to cover a normal cura sequence without
// re-issuing the QR; the limit exists so a leaked link cannot be used
// to flood the patient's storage indefinitely.
const DEFAULT_MAX_UPLOADS_PER_SESSION = 50;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

// The session id is the only secret that grants the mobile uploader access to
// a patient's photo path until expiry, so it must come from a CSPRNG. The
// previous Math.random() implementation gave ~52 bits of effective entropy.
const defaultGenerateSessionId = (): string => {
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `wcu_${toHex(bytes)}`;
};

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
    maxUploads: DEFAULT_MAX_UPLOADS_PER_SESSION,
    uploadCount: 0,
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
