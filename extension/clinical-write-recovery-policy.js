/** Pure decisions for the two-phase recovery of protected clinical writes. */
(function (root) {
  'use strict';

  const RECOVERY_DELAY_MS = 60 * 1000;
  const RECOVERY_PREVIEW_TTL_MS = 5 * 60 * 1000;
  const VALID_GENERATION = /^[a-f0-9-]{20,}$/i;
  const PREVIEW_STATES = Object.freeze([
    'in-flight',
    'ambiguous',
    'awaiting-client-ack',
    'awaiting-recovery-confirm',
  ]);

  const buildRecoveryResetTransition = () => ({
    state: 'ambiguous',
    receiptId: '',
    recoveryTokenHash: '',
    recoveryReviewMac: '',
    recoveryPreviewedAt: 0,
    recoveryPreviewExpiresAt: 0,
  });

  const parseRecoveryKey = rawKey => {
    const key = String(rawKey || '');
    const handoffMatch = key.match(/^handoff(?::(medical))?:(\d+)$/);
    if (handoffMatch) {
      return {
        key,
        kind: 'handoff',
        encId: handoffMatch[2],
        instrument: '',
        requiredHandoffKind: handoffMatch[1] || 'nursing',
      };
    }
    const scoreMatch = key.match(/^score:(\d+):(CUDYR|BRADEN|DOWNTON)$/);
    if (!scoreMatch) return null;
    return {
      key,
      kind: 'score',
      encId: scoreMatch[1],
      instrument: scoreMatch[2],
      requiredHandoffKind: '',
    };
  };

  const parseRecoveryRequest = request => {
    const source = request && typeof request === 'object' ? request : {};
    const recoveryKey = parseRecoveryKey(source.key);
    const generationId = String(source.generationId || '');
    const phase = String(source.phase || '');
    const challenge = String(source.recoveryToken || '');
    const validChallenge = phase !== 'confirm' || VALID_GENERATION.test(challenge);
    const validRequest = [
      recoveryKey,
      VALID_GENERATION.test(generationId),
      ['preview', 'confirm'].includes(phase),
      validChallenge,
    ].every(Boolean);

    if (!validRequest) {
      return { error: 'La solicitud para liberar la protección clínica no es válida.' };
    }

    return {
      recovery: {
        ...recoveryKey,
        generationId,
        phase,
        recoveryToken: challenge,
      },
    };
  };

  const validateRecoveryMarker = ({ protection, generationId, phase }) => {
    const marker = protection && protection.marker || {};
    const markerState = String(marker.state || '');
    const phaseAllowsState = phase === 'preview'
      ? PREVIEW_STATES.includes(markerState)
      : markerState === 'awaiting-recovery-confirm';

    if (!protection || !protection.active || marker.generationId !== generationId ||
        !phaseAllowsState) {
      return { error: 'La protección cambió y no se liberó.' };
    }
    return { marker };
  };

  const validateConfirmationChallenge = ({ marker, confirmedTokenHash, currentTime }) => {
    if (!marker.recoveryTokenHash || !marker.recoveryReviewMac ||
        confirmedTokenHash !== marker.recoveryTokenHash) {
      return {
        error: 'La lectura revisada ya no coincide con esta protección. ' +
          'Actualiza y revísala nuevamente.',
      };
    }
    const previewExpiresAt = Number(marker.recoveryPreviewExpiresAt);
    if (!Number.isFinite(previewExpiresAt) || previewExpiresAt <= currentTime) {
      return {
        error: 'La lectura fresca expiró y la protección se mantuvo. ' +
          'Actualiza y revísala nuevamente.',
        resetTransition: buildRecoveryResetTransition(),
      };
    }
    return { ok: true };
  };

  const evaluateRecoveryTiming = ({ marker, currentTime }) => {
    const markerCreatedAt = Number(marker && marker.createdAt);
    if (!Number.isFinite(markerCreatedAt) || markerCreatedAt <= 0) {
      return {
        error: 'La protección no informó una fecha válida y no se liberó. ' +
          'Recarga la extensión para conservar el bloqueo preventivo.',
      };
    }
    const recoveryAge = currentTime - markerCreatedAt;
    if (!Number.isFinite(recoveryAge) || recoveryAge < RECOVERY_DELAY_MS) {
      const waitSeconds = Math.max(
        1,
        Math.ceil((RECOVERY_DELAY_MS - Math.max(0, recoveryAge)) / 1000)
      );
      return {
        error: 'Eloísa aún puede estar actualizando el registro. Espera ' + waitSeconds +
          ' s, actualiza la tabla y vuelve a revisar antes de liberar.',
      };
    }
    return { ok: true };
  };

  const evaluatePreviewState = ({
    previewToken,
    tokenHash,
    reviewMac,
    review,
    previewedAt,
    expiresAt,
  }) => ({
    transition: {
      state: 'awaiting-recovery-confirm',
      receiptId: '',
      recoveryTokenHash: tokenHash,
      recoveryReviewMac: reviewMac,
      recoveryPreviewedAt: previewedAt,
      recoveryPreviewExpiresAt: expiresAt,
    },
    response: {
      ok: true,
      recoveryPreview: { challenge: previewToken, review },
    },
  });

  const evaluateConfirmationState = ({ marker, confirmedTokenHash, currentReviewMac }) => {
    if (currentReviewMac !== marker.recoveryReviewMac) {
      return {
        error: 'El registro cambió después de mostrar la lectura fresca. ' +
          'La protección se mantuvo; actualiza y revisa nuevamente.',
        resetTransition: buildRecoveryResetTransition(),
      };
    }
    return {
      clearExpected: {
        state: 'awaiting-recovery-confirm',
        generationId: String(marker.generationId || ''),
        recoveryTokenHash: confirmedTokenHash,
        recoveryReviewMac: currentReviewMac,
      },
    };
  };

  root.HhrClinicalWriteRecoveryPolicy = Object.freeze({
    RECOVERY_DELAY_MS,
    RECOVERY_PREVIEW_TTL_MS,
    buildRecoveryResetTransition,
    evaluateConfirmationState,
    evaluatePreviewState,
    evaluateRecoveryTiming,
    parseRecoveryRequest,
    validateConfirmationChallenge,
    validateRecoveryMarker,
  });
})(typeof self !== 'undefined' ? self : globalThis);
