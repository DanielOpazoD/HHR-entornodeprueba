/**
 * hhr-clinical-write-client-runtime.js (ISOLATED world)
 *
 * Owns the browser-side coordination for verified clinical writes: receipt acknowledgement,
 * persisted protection hydration/recovery and modal transition guards. The consumer injects all
 * UI and transport dependencies so this classic runtime can be tested without Eloisa or Chrome.
 */
(() => {
  'use strict';

  if (globalThis.HhrClinicalWriteClientRuntime) return;

  const DEFAULT_ACK_TIMEOUT_MS = 9_000;

  const create = dependencies => {
    const {
      chromeApi,
      windowRef,
      helper,
      runtimeMessages,
      sendMessage,
      requestPageConfirmation,
      showPageNotice,
      setRouteChangeState,
      ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS,
    } = dependencies || {};

    if (
      !chromeApi ||
      !chromeApi.runtime ||
      !windowRef ||
      typeof windowRef.setTimeout !== 'function' ||
      typeof windowRef.clearTimeout !== 'function' ||
      !helper ||
      !runtimeMessages ||
      typeof sendMessage !== 'function' ||
      typeof requestPageConfirmation !== 'function' ||
      typeof showPageNotice !== 'function' ||
      typeof setRouteChangeState !== 'function' ||
      !Number.isFinite(ackTimeoutMs) ||
      ackTimeoutMs <= 0
    ) {
      throw new Error('No se pudo inicializar el coordinador de escrituras clínicas HHR.');
    }

    const uncertainClinicalWrites = new Map();
    const getActiveUncertainWrite = key => uncertainClinicalWrites.get(key) || null;

    const acknowledgeClinicalWrite = receipt =>
      new Promise(resolve => {
        if (!receipt || !receipt.key || !receipt.generationId || !receipt.receiptId) {
          resolve({ error: 'Eloísa no entregó un acuse local verificable para este guardado.' });
          return;
        }

        let settled = false;
        let timer = null;
        const settle = result => {
          if (settled) return false;
          settled = true;
          if (timer !== null) windowRef.clearTimeout(timer);
          resolve(result);
          return true;
        };

        timer = windowRef.setTimeout(() => {
          settle({
            error: 'La extensión no confirmó el acuse local dentro del tiempo esperado.',
          });
        }, ackTimeoutMs);

        try {
          chromeApi.runtime.sendMessage({
            type: runtimeMessages.CLINICAL_WRITE_ACK,
            key: receipt.key,
            generationId: receipt.generationId,
            receiptId: receipt.receiptId,
          }, response => {
            const error = chromeApi.runtime.lastError;
            settle(error
              ? { error: String(error.message || error) }
              : response && response.ok ? { ok: true } : {
                  error: String(
                    response && response.error || 'La extensión no confirmó el acuse local.'
                  ),
                });
          });
        } catch (error) {
          settle({ error: String((error && error.message) || error) });
        }
      });

    const hydrateClinicalWriteProtection = (key, protection) => {
      if (!protection || typeof protection !== 'object') {
        uncertainClinicalWrites.delete(key);
        return null;
      }
      const marker = {
        state: String(protection.state || 'ambiguous'),
        generationId: String(protection.generationId || ''),
        receiptId: String(protection.receiptId || ''),
        startedAt: Number(protection.createdAt || Date.now()),
        error: String(
          protection.error || 'Revisa el último dato visible antes de liberar la protección.'
        ),
        displayObservation: '',
        observation: '',
      };
      uncertainClinicalWrites.set(key, marker);
      return marker;
    };

    const formatClinicalRecoveryReview = review => {
      if (!review || typeof review !== 'object') {
        return 'Eloísa no informó un registro vigente.';
      }
      if (review.kind === 'handoff') {
        return [
          'Última entrega leída ahora:',
          review.present ? String(review.value || 'Sin texto') : 'Sin entrega registrada',
          'Fecha: ' + (review.dateTime ? helper.formatDateTimeLabel(review.dateTime) : 'Sin fecha'),
          'Profesional: ' + String(review.author || 'No informado'),
        ].join('\n');
      }
      return [
        String(review.instrument || 'Score') + ' leído ahora:',
        review.present ? 'Valor: ' + String(review.value || '—') : 'Sin aplicación registrada',
        review.classification ? 'Clasificación: ' + String(review.classification) : '',
        'Fecha: ' + (review.dateTime ? helper.formatDateTimeLabel(review.dateTime) : 'Sin fecha'),
        'Profesional: ' + String(review.author || 'No informado'),
      ].filter(Boolean).join('\n');
    };

    const releaseClinicalWriteProtection = async (key, protection) => {
      const preview = await sendMessage({
        type: runtimeMessages.CLINICAL_WRITE_RECOVERY_REQUEST,
        key,
        generationId: protection && protection.generationId,
        phase: 'preview',
      });
      if (!preview || preview.error) return preview;
      const recoveryPreview = preview.recoveryPreview || {};
      if (!recoveryPreview.challenge || !recoveryPreview.review) {
        return { error: 'Eloísa no devolvió una lectura fresca verificable; la protección se mantuvo.' };
      }
      const confirmed = await requestPageConfirmation({
        title: 'Revisión del último guardado',
        message: 'Eloísa se consultó nuevamente.\n\n' +
          formatClinicalRecoveryReview(recoveryPreview.review) +
          '\n\nLibera la protección solo si este resultado coincide con lo que registraste.',
        confirmLabel: 'Revisado, liberar',
      });
      if (!confirmed) return { cancelled: true };
      return sendMessage({
        type: runtimeMessages.CLINICAL_WRITE_RECOVERY_REQUEST,
        key,
        generationId: protection && protection.generationId,
        phase: 'confirm',
        ['recoveryToken']: recoveryPreview.challenge,
      });
    };

    const clinicalWriteRecoveryReady = protection =>
      Boolean(protection && Date.now() - Number(protection.createdAt || 0) >= 60 * 1000);

    const normalizedClinicalText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const clinicalWriteKey = (kind, encId, instrument = '') => {
      const parts = [kind, String(encId || '')];
      if (instrument) parts.push(String(instrument).toUpperCase());
      return parts.join(':');
    };

    const getClinicalGuard = root => {
      if (!root.__hhrClinicalGuard) {
        root.__hhrClinicalGuard = {
          dirty: new Set(),
          pending: new Set(),
          uncertain: new Set(),
          confirming: false,
        };
      }
      return root.__hhrClinicalGuard;
    };

    const setClinicalGuardState = (root, state, key, active) => {
      const bucket = getClinicalGuard(root)[state];
      if (active) bucket.add(key);
      else bucket.delete(key);
    };

    const runClinicalTransition = (root, action, { allowUncertain = false } = {}) => {
      const guard = getClinicalGuard(root);
      if (guard.pending.size) {
        setRouteChangeState(root, 'Guardado clínico en curso · espera su confirmación', 'uncertain');
        showPageNotice('Espera a que Eloísa confirme el guardado antes de cambiar de módulo.', {
          title: 'Guardado en curso',
        });
        return false;
      }
      if (guard.dirty.size) {
        if (guard.confirming) return false;
        guard.confirming = true;
        void requestPageConfirmation({
          title: 'Cambios sin guardar',
          message: 'Hay cambios clínicos sin guardar. ¿Quieres descartarlos y continuar?',
          confirmLabel: 'Descartar y continuar',
        }).then(confirmed => {
          guard.confirming = false;
          if (!confirmed || guard.pending.size) return;
          guard.dirty.clear();
          showPageNotice('Los cambios que no se habían guardado fueron descartados.', {
            title: 'Cambio de módulo',
          });
          if (root.isConnected) action();
        });
        return false;
      }
      if (!allowUncertain && guard.uncertain.size) {
        showPageNotice(
          'El resultado de un guardado aún no pudo verificarse. Puedes continuar: la protección contra duplicados se mantiene activa.',
          { title: 'Verificación pendiente' }
        );
      }
      action();
      return true;
    };

    const finishRouteChangeWrite = (root, state) => {
      if (!root || root.dataset.routeStale !== 'true') return;
      if (getClinicalGuard(root).pending.size) {
        setRouteChangeState(root, 'Episodio cambió · esperando confirmación del guardado');
        return;
      }
      if (state === 'synced') {
        setRouteChangeState(root, 'Episodio cambió · guardado confirmado', 'synced');
      } else if (state === 'uncertain') {
        setRouteChangeState(root, 'Episodio cambió · guardado no verificado', 'uncertain');
      } else {
        setRouteChangeState(root, 'Episodio cambió · guardado falló', 'error');
      }
    };

    const freezeClinicalModalForEncounterChange = root => {
      if (!root || root.dataset.routeStale === 'true') return;
      root.dataset.routeStale = 'true';
      const close = root.querySelector('.hhr-rx-close');
      const blockStaleInteraction = event => {
        if (close && (event.target === close || close.contains(event.target))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'focusin' && close) close.focus();
      };
      ['click', 'input', 'change', 'submit', 'focusin'].forEach(type =>
        root.addEventListener(type, blockStaleInteraction, true)
      );
      const header = root.querySelector('.hhr-center-header');
      if (header) {
        const notice = root.ownerDocument.createElement('span');
        notice.className = 'hhr-route-change-state';
        header.appendChild(notice);
        setRouteChangeState(root, 'Episodio cambió · esperando confirmación del guardado');
      }
      if (close) close.focus();
    };

    return Object.freeze({
      acknowledgeClinicalWrite,
      clinicalWriteKey,
      clinicalWriteRecoveryReady,
      finishRouteChangeWrite,
      freezeClinicalModalForEncounterChange,
      getActiveUncertainWrite,
      getClinicalGuard,
      hydrateClinicalWriteProtection,
      normalizedClinicalText,
      releaseClinicalWriteProtection,
      runClinicalTransition,
      setClinicalGuardState,
      uncertainClinicalWrites,
    });
  };

  globalThis.HhrClinicalWriteClientRuntime = Object.freeze({ create });
})();
