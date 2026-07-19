/** Cross-workflow clinical write coordination; clinical endpoints remain in background.js. */
(function (root) {
  'use strict';

  const REQUIRED_RECOVERY_POLICY_FUNCTIONS = [
    'evaluateConfirmationState',
    'evaluatePreviewState',
    'evaluateRecoveryTiming',
    'parseRecoveryRequest',
    'validateConfirmationChallenge',
    'validateRecoveryMarker',
  ];

  const isRecoveryPolicyReady = policy => Boolean(
    policy && Number.isFinite(policy.RECOVERY_PREVIEW_TTL_MS) &&
    REQUIRED_RECOVERY_POLICY_FUNCTIONS.every(name => typeof policy[name] === 'function')
  );

  const create = dependencies => {
    const {
      chrome: chromeApi,
      storage,
      crypto: cryptoApi,
      now,
      authorizeRecovery,
      readRecoveryReview,
      recoveryPolicy,
    } = dependencies || {};

    if (
      !chromeApi || !storage || typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' || typeof storage.remove !== 'function' ||
      !cryptoApi || !cryptoApi.subtle || typeof cryptoApi.getRandomValues !== 'function' ||
      typeof now !== 'function' || typeof authorizeRecovery !== 'function' ||
      typeof readRecoveryReview !== 'function' || !isRecoveryPolicyReady(recoveryPolicy)
    ) {
      throw new Error('No se pudo inicializar el runtime de escrituras clínicas.');
    }

    const writeLocks = new Set();
    const confirmationLocks = new Set();

    const ambiguityStorageKey = async key => {
      const bytes = new TextEncoder().encode(String(key || ''));
      const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
      const hash = Array.from(
        new Uint8Array(digest),
        value => value.toString(16).padStart(2, '0')
      ).join('');
      return 'hhr-clinical-write-guard-' + hash;
    };

    const readAmbiguity = async key => {
      try {
        const storageKey = await ambiguityStorageKey(key);
        const stored = await storage.get(storageKey);
        const marker = stored && stored[storageKey];
        return marker ? { active: true, marker } : { active: false };
      } catch (error) {
        return {
          error: 'No se pudo comprobar la protección contra duplicados: ' +
            String((error && error.message) || error),
        };
      }
    };

    const persistAmbiguity = async (key, details = {}) => {
      const currentTime = now();
      const createdAt = Number(details.createdAt || currentTime);
      const marker = {
        schemaVersion: 3,
        state: String(details.state || 'ambiguous'),
        generationId: String(details.generationId || ''),
        receiptId: String(details.receiptId || ''),
        recoveryTokenHash: String(details.recoveryTokenHash || ''),
        recoveryReviewMac: String(details.recoveryReviewMac || ''),
        recoveryPreviewedAt: Number(details.recoveryPreviewedAt || 0),
        recoveryPreviewExpiresAt: Number(details.recoveryPreviewExpiresAt || 0),
        createdAt,
        updatedAt: currentTime,
      };
      try {
        const storageKey = await ambiguityStorageKey(key);
        await storage.set({ [storageKey]: marker });
        return { ok: true, marker };
      } catch (error) {
        return {
          error: 'No se pudo persistir el bloqueo preventivo: ' +
            String((error && error.message) || error),
        };
      }
    };

    const transitionAmbiguity = async (key, generationId, details = {}) => {
      try {
        const storageKey = await ambiguityStorageKey(key);
        const stored = await storage.get(storageKey);
        const marker = stored && stored[storageKey];
        if (!marker || marker.generationId !== generationId) {
          return { error: 'La generación del guardado clínico cambió; se mantuvo su protección.' };
        }
        return persistAmbiguity(key, {
          ...marker,
          ...details,
          generationId,
          createdAt: marker.createdAt,
        });
      } catch (error) {
        return {
          error: 'No se pudo actualizar la protección del guardado clínico: ' +
            String((error && error.message) || error),
        };
      }
    };

    const clearAmbiguity = async (key, expected = {}) => {
      try {
        const storageKey = await ambiguityStorageKey(key);
        if (expected.state || expected.generationId || expected.receiptId ||
            expected.recoveryTokenHash || expected.recoveryReviewMac) {
          const stored = await storage.get(storageKey);
          const marker = stored && stored[storageKey];
          if (!marker || expected.state && marker.state !== expected.state ||
              expected.generationId && marker.generationId !== expected.generationId ||
              expected.receiptId && marker.receiptId !== expected.receiptId ||
              expected.recoveryTokenHash && marker.recoveryTokenHash !== expected.recoveryTokenHash ||
              expected.recoveryReviewMac && marker.recoveryReviewMac !== expected.recoveryReviewMac) {
            return { error: 'La protección pertenece a otro guardado clínico y no se liberó.' };
          }
        }
        await storage.remove(storageKey);
        return { ok: true };
      } catch (error) {
        return {
          error: 'No se pudo liberar la protección local del guardado: ' +
            String((error && error.message) || error),
        };
      }
    };

    const createReceiptId = () => {
      if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
      const bytes = new Uint32Array(4);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('-');
    };

    const acknowledge = async ({ key, generationId, receiptId }) => {
      const normalizedKey = String(key || '');
      const normalizedGenerationId = String(generationId || '');
      const normalizedReceiptId = String(receiptId || '');
      if (!/^(?:handoff:\d+|score:\d+:(?:CUDYR|BRADEN|DOWNTON))$/.test(normalizedKey) ||
          !/^[a-f0-9-]{20,}$/i.test(normalizedGenerationId) ||
          !/^[a-f0-9-]{20,}$/i.test(normalizedReceiptId)) {
        return { error: 'El acuse del guardado clínico no es válido.' };
      }
      if (writeLocks.has(normalizedKey) || confirmationLocks.has(normalizedKey)) {
        return { error: 'El guardado clínico todavía está procesando otra confirmación.' };
      }
      confirmationLocks.add(normalizedKey);
      try {
        const storageKey = await ambiguityStorageKey(normalizedKey);
        const stored = await storage.get(storageKey);
        const marker = stored && stored[storageKey];
        if (!marker || marker.state !== 'awaiting-client-ack' ||
            marker.generationId !== normalizedGenerationId ||
            marker.receiptId !== normalizedReceiptId) {
          return { error: 'El acuse no coincide con el guardado clínico pendiente.' };
        }
        const cleared = await clearAmbiguity(normalizedKey, {
          generationId: normalizedGenerationId,
          receiptId: normalizedReceiptId,
        });
        return cleared.error ? cleared : { ok: true };
      } catch (error) {
        return {
          error: 'No se pudo confirmar localmente la recepción del guardado: ' +
            String((error && error.message) || error),
        };
      } finally {
        confirmationLocks.delete(normalizedKey);
      }
    };

    const serializeProtection = async key => {
      const result = await readAmbiguity(key);
      if (result.error) return { state: 'unavailable', error: result.error };
      if (!result.active) return null;
      const marker = result.marker || {};
      return {
        key,
        state: String(marker.state || 'ambiguous'),
        generationId: String(marker.generationId || ''),
        receiptId: marker.state === 'awaiting-client-ack' ? String(marker.receiptId || '') : '',
        createdAt: Number(marker.createdAt || 0),
      };
    };

    const withWriteLock = async (key, task) => {
      const ambiguity = await readAmbiguity(key);
      if (ambiguity.error) return ambiguity;
      if (ambiguity.active) {
        return {
          error: 'Existe un guardado clínico pendiente de confirmación. Actualiza los datos y revisa ' +
            'su estado en Eloísa antes de volver a registrar.',
          writeMayHaveSucceeded: true,
          clinicalWriteProtection: {
            state: String(ambiguity.marker && ambiguity.marker.state || 'ambiguous'),
            generationId: String(ambiguity.marker && ambiguity.marker.generationId || ''),
          },
        };
      }
      if (writeLocks.has(key) || confirmationLocks.has(key)) {
        return { error: 'Ya hay un guardado clínico en curso para este paciente.' };
      }
      let generationId = '';
      try {
        generationId = createReceiptId();
      } catch (error) {
        return {
          error: 'No se pudo preparar el identificador seguro del guardado: ' +
            String((error && error.message) || error),
        };
      }
      writeLocks.add(key);
      let writeBegun = false;
      const writeGuard = {
        generationId,
        beginWrite: async () => {
          if (writeBegun) return { ok: true };
          const persisted = await persistAmbiguity(key, { state: 'in-flight', generationId });
          if (persisted.error) return persisted;
          writeBegun = true;
          return { ok: true };
        },
      };
      try {
        const result = await task(writeGuard);
        if (!writeBegun) return result;
        const publicResult = result && typeof result === 'object'
          ? Object.fromEntries(
              Object.entries(result).filter(([name]) => name !== 'definitelyNotApplied')
            )
          : result;
        if (result && result.definitelyNotApplied) {
          const cleared = await clearAmbiguity(key, { generationId });
          if (cleared.error) {
            return { ...publicResult, error: String(result.error || '') + ' ' + cleared.error };
          }
          return publicResult;
        }
        if (result && result.ok && result.verified) {
          let receiptId = '';
          try {
            receiptId = createReceiptId();
          } catch (error) {
            const protectedResult = await transitionAmbiguity(key, generationId, {
              state: 'ambiguous',
            });
            return {
              error: 'El guardado fue verificado en Eloísa, pero no se pudo crear su acuse local. ' +
                String((error && error.message) || error) +
                (protectedResult.error ? ' ' + protectedResult.error : '') +
                ' Actualiza antes de reintentar.',
              writeMayHaveSucceeded: true,
            };
          }
          const persisted = await transitionAmbiguity(key, generationId, {
            state: 'awaiting-client-ack',
            receiptId,
          });
          if (persisted.error) {
            return {
              error: 'El guardado fue verificado en Eloísa, pero no se pudo proteger su confirmación local. ' +
                persisted.error + ' Actualiza antes de reintentar.',
              writeMayHaveSucceeded: true,
            };
          }
          return {
            ...publicResult,
            clinicalWriteReceipt: { key, generationId, receiptId },
          };
        }
        const persisted = await transitionAmbiguity(key, generationId, { state: 'ambiguous' });
        if (persisted.error) {
          return {
            ...(publicResult && typeof publicResult === 'object' ? publicResult : {}),
            error: String(publicResult && publicResult.error || 'El guardado no pudo confirmarse.') +
              ' ' + persisted.error,
            writeMayHaveSucceeded: true,
          };
        }
        return {
          ...(publicResult && typeof publicResult === 'object' ? publicResult : {}),
          writeMayHaveSucceeded: true,
        };
      } catch (error) {
        if (!writeBegun) {
          return {
            error: 'No se pudo preparar el guardado clínico: ' +
              String((error && error.message) || error),
          };
        }
        const persisted = await transitionAmbiguity(key, generationId, { state: 'ambiguous' });
        return {
          error: 'Se perdió la confirmación del guardado clínico: ' +
            String((error && error.message) || error) +
            (persisted.error ? ' ' + persisted.error : ''),
          writeMayHaveSucceeded: true,
        };
      } finally {
        writeLocks.delete(key);
      }
    };

    const hashRecoveryToken = async token => {
      const bytes = new TextEncoder().encode(String(token || ''));
      const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
      return Array.from(
        new Uint8Array(digest),
        value => value.toString(16).padStart(2, '0')
      ).join('');
    };

    const createRecoveryToken = () => {
      const bytes = new Uint8Array(32);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    };

    const signRecoveryReview = async (review, token, generationId) => {
      const encoder = new TextEncoder();
      const signingKey = await cryptoApi.subtle.importKey(
        'raw',
        encoder.encode(String(token || '')),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await cryptoApi.subtle.sign(
        'HMAC',
        signingKey,
        encoder.encode(JSON.stringify({ generationId: String(generationId || ''), review }))
      );
      return Array.from(
        new Uint8Array(signature),
        value => value.toString(16).padStart(2, '0')
      ).join('');
    };

    const resetRecoveryProtection = async ({ recovery, decision }) => {
      const reset = await transitionAmbiguity(
        recovery.key,
        recovery.generationId,
        decision.resetTransition
      );
      return { error: decision.error + (reset.error ? ' ' + reset.error : '') };
    };

    const validateRecoveryConfirmation = async ({ recovery, marker }) => {
      if (recovery.phase !== 'confirm') return { confirmedTokenHash: '' };
      const confirmedTokenHash = await hashRecoveryToken(recovery.recoveryToken);
      const decision = recoveryPolicy.validateConfirmationChallenge({
        marker,
        confirmedTokenHash,
        currentTime: now(),
      });
      if (decision.resetTransition) {
        return { response: await resetRecoveryProtection({ recovery, decision }) };
      }
      if (decision.error) return { response: { error: decision.error } };
      return { confirmedTokenHash };
    };

    const persistRecoveryPreview = async ({ recovery, review }) => {
      const previewToken = createRecoveryToken();
      const [tokenHash, reviewMac] = await Promise.all([
        hashRecoveryToken(previewToken),
        signRecoveryReview(review, previewToken, recovery.generationId),
      ]);
      const decision = recoveryPolicy.evaluatePreviewState({
        previewToken,
        tokenHash,
        reviewMac,
        review,
        previewedAt: now(),
        expiresAt: now() + recoveryPolicy.RECOVERY_PREVIEW_TTL_MS,
      });
      const persisted = await transitionAmbiguity(
        recovery.key,
        recovery.generationId,
        decision.transition
      );
      return persisted.error ? persisted : decision.response;
    };

    const confirmRecoveryReview = async ({ recovery, marker, review, confirmedTokenHash }) => {
      const currentReviewMac = await signRecoveryReview(
        review,
        recovery.recoveryToken,
        recovery.generationId
      );
      const decision = recoveryPolicy.evaluateConfirmationState({
        marker,
        confirmedTokenHash,
        currentReviewMac,
      });
      if (decision.resetTransition) {
        return resetRecoveryProtection({ recovery, decision });
      }
      const cleared = await clearAmbiguity(recovery.key, decision.clearExpected);
      return cleared.error ? cleared : { ok: true };
    };

    const recover = async request => {
      const parsed = recoveryPolicy.parseRecoveryRequest(request);
      if (parsed.error) return parsed;
      const recovery = parsed.recovery;
      if (writeLocks.has(recovery.key) || confirmationLocks.has(recovery.key)) {
        return { error: 'La escritura clínica todavía está procesando otra operación.' };
      }
      confirmationLocks.add(recovery.key);
      try {
        const protection = await readAmbiguity(recovery.key);
        const markerValidation = recoveryPolicy.validateRecoveryMarker({
          protection,
          generationId: recovery.generationId,
          phase: recovery.phase,
        });
        if (markerValidation.error) return markerValidation;
        const marker = markerValidation.marker;
        const confirmation = await validateRecoveryConfirmation({ recovery, marker });
        if (confirmation.response) return confirmation.response;
        const timing = recoveryPolicy.evaluateRecoveryTiming({ marker, currentTime: now() });
        if (timing.error) return timing;
        const authorized = await authorizeRecovery({
          kind: recovery.kind,
          encId: recovery.encId,
          instrument: recovery.instrument,
          requiredHandoffKind: recovery.requiredHandoffKind,
        });
        if (authorized.error) return authorized;
        const reviewResult = await readRecoveryReview({
          kind: recovery.kind,
          encId: recovery.encId,
          instrument: recovery.instrument,
          info: authorized.info,
        });
        if (reviewResult.error) return reviewResult;
        if (recovery.phase === 'preview') {
          return await persistRecoveryPreview({ recovery, review: reviewResult.review });
        }
        return await confirmRecoveryReview({
          recovery,
          marker,
          review: reviewResult.review,
          confirmedTokenHash: confirmation.confirmedTokenHash,
        });
      } catch (error) {
        return {
          error: 'No se pudo verificar y liberar la protección: ' +
            String((error && error.message) || error),
        };
      } finally {
        confirmationLocks.delete(recovery.key);
      }
    };

    return Object.freeze({ acknowledge, recover, serializeProtection, withWriteLock });
  };

  root.HhrClinicalWriteRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
