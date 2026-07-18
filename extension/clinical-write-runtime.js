/** Cross-workflow clinical write coordination; clinical endpoints remain in background.js. */
(function (root) {
  'use strict';

  const RECOVERY_DELAY_MS = 60 * 1000;
  const RECOVERY_PREVIEW_TTL_MS = 5 * 60 * 1000;

  const create = dependencies => {
    const {
      chrome: chromeApi,
      storage,
      crypto: cryptoApi,
      now,
      authorizeRecovery,
      readRecoveryReview,
    } = dependencies || {};

    if (
      !chromeApi || !storage || typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' || typeof storage.remove !== 'function' ||
      !cryptoApi || !cryptoApi.subtle || typeof cryptoApi.getRandomValues !== 'function' ||
      typeof now !== 'function' || typeof authorizeRecovery !== 'function' ||
      typeof readRecoveryReview !== 'function'
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

    const recover = async ({ key, generationId, phase, recoveryToken }) => {
      const normalizedKey = String(key || '');
      const normalizedGenerationId = String(generationId || '');
      const normalizedPhase = String(phase || '');
      const normalizedRecoveryToken = String(recoveryToken || '');
      const handoffMatch = normalizedKey.match(/^handoff(?::(medical))?:(\d+)$/);
      const scoreMatch = normalizedKey.match(/^score:(\d+):(CUDYR|BRADEN|DOWNTON)$/);
      const recoveryKind = handoffMatch ? 'handoff' : scoreMatch ? 'score' : '';
      const recoveryEncId = handoffMatch ? handoffMatch[2] : scoreMatch ? scoreMatch[1] : '';
      const recoveryInstrument = scoreMatch ? scoreMatch[2] : '';
      const requiredHandoffKind = handoffMatch ? handoffMatch[1] || 'nursing' : '';
      if (!recoveryKind || !/^[a-f0-9-]{20,}$/i.test(normalizedGenerationId) ||
          !['preview', 'confirm'].includes(normalizedPhase) ||
          normalizedPhase === 'confirm' &&
            !/^[a-f0-9-]{20,}$/i.test(normalizedRecoveryToken)) {
        return { error: 'La solicitud para liberar la protección clínica no es válida.' };
      }
      if (writeLocks.has(normalizedKey) || confirmationLocks.has(normalizedKey)) {
        return { error: 'La escritura clínica todavía está procesando otra operación.' };
      }
      confirmationLocks.add(normalizedKey);
      try {
        const protection = await readAmbiguity(normalizedKey);
        const marker = protection.marker || {};
        const markerState = String(marker.state || '');
        const allowedPreviewStates = [
          'in-flight',
          'ambiguous',
          'awaiting-client-ack',
          'awaiting-recovery-confirm',
        ];
        if (!protection.active || marker.generationId !== normalizedGenerationId ||
            normalizedPhase === 'preview' && !allowedPreviewStates.includes(markerState) ||
            normalizedPhase === 'confirm' && markerState !== 'awaiting-recovery-confirm') {
          return { error: 'La protección cambió y no se liberó.' };
        }
        let confirmedTokenHash = '';
        if (normalizedPhase === 'confirm') {
          confirmedTokenHash = await hashRecoveryToken(normalizedRecoveryToken);
          if (!marker.recoveryTokenHash || !marker.recoveryReviewMac ||
              confirmedTokenHash !== marker.recoveryTokenHash) {
            return {
              error: 'La lectura revisada ya no coincide con esta protección. ' +
                'Actualiza y revísala nuevamente.',
            };
          }
          const previewExpiresAt = Number(marker.recoveryPreviewExpiresAt);
          if (!Number.isFinite(previewExpiresAt) || previewExpiresAt <= now()) {
            const reset = await transitionAmbiguity(normalizedKey, normalizedGenerationId, {
              state: 'ambiguous',
              receiptId: '',
              recoveryTokenHash: '',
              recoveryReviewMac: '',
              recoveryPreviewedAt: 0,
              recoveryPreviewExpiresAt: 0,
            });
            return {
              error: 'La lectura fresca expiró y la protección se mantuvo. ' +
                'Actualiza y revísala nuevamente.' + (reset.error ? ' ' + reset.error : ''),
            };
          }
        }
        const markerCreatedAt = Number(marker.createdAt);
        if (!Number.isFinite(markerCreatedAt) || markerCreatedAt <= 0) {
          return {
            error: 'La protección no informó una fecha válida y no se liberó. ' +
              'Recarga la extensión para conservar el bloqueo preventivo.',
          };
        }
        const recoveryAge = now() - markerCreatedAt;
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
        const authorized = await authorizeRecovery({
          kind: recoveryKind,
          encId: recoveryEncId,
          instrument: recoveryInstrument,
          requiredHandoffKind,
        });
        if (authorized.error) return authorized;
        const reviewResult = await readRecoveryReview({
          kind: recoveryKind,
          encId: recoveryEncId,
          instrument: recoveryInstrument,
          info: authorized.info,
        });
        if (reviewResult.error) return reviewResult;
        if (normalizedPhase === 'preview') {
          const previewToken = createRecoveryToken();
          const [tokenHash, reviewMac] = await Promise.all([
            hashRecoveryToken(previewToken),
            signRecoveryReview(reviewResult.review, previewToken, normalizedGenerationId),
          ]);
          const persisted = await transitionAmbiguity(normalizedKey, normalizedGenerationId, {
            state: 'awaiting-recovery-confirm',
            receiptId: '',
            recoveryTokenHash: tokenHash,
            recoveryReviewMac: reviewMac,
            recoveryPreviewedAt: now(),
            recoveryPreviewExpiresAt: now() + RECOVERY_PREVIEW_TTL_MS,
          });
          if (persisted.error) return persisted;
          return {
            ok: true,
            recoveryPreview: { challenge: previewToken, review: reviewResult.review },
          };
        }
        const reviewMac = await signRecoveryReview(
          reviewResult.review,
          normalizedRecoveryToken,
          normalizedGenerationId
        );
        if (reviewMac !== marker.recoveryReviewMac) {
          const reset = await transitionAmbiguity(normalizedKey, normalizedGenerationId, {
            state: 'ambiguous',
            receiptId: '',
            recoveryTokenHash: '',
            recoveryReviewMac: '',
            recoveryPreviewedAt: 0,
            recoveryPreviewExpiresAt: 0,
          });
          return {
            error: 'El registro cambió después de mostrar la lectura fresca. ' +
              'La protección se mantuvo; actualiza y revisa nuevamente.' +
              (reset.error ? ' ' + reset.error : ''),
          };
        }
        const cleared = await clearAmbiguity(normalizedKey, {
          state: 'awaiting-recovery-confirm',
          generationId: normalizedGenerationId,
          recoveryTokenHash: confirmedTokenHash,
          recoveryReviewMac: reviewMac,
        });
        return cleared.error ? cleared : { ok: true };
      } catch (error) {
        return {
          error: 'No se pudo verificar y liberar la protección: ' +
            String((error && error.message) || error),
        };
      } finally {
        confirmationLocks.delete(normalizedKey);
      }
    };

    return Object.freeze({ acknowledge, recover, serializeProtection, withWriteLock });
  };

  root.HhrClinicalWriteRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
