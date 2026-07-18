/**
 * hhr-medication-actions-runtime.js (ISOLATED world)
 *
 * Owns the medication-related actions rendered by the Ficha Médico orchestrator: indications,
 * regimen/BRADEN printing and browser-local favorites. The consumer injects route, messaging and
 * shared-modal dependencies so this classic script stays testable and fails closed when incomplete.
 */
(() => {
  'use strict';

  if (globalThis.HhrMedicationActionsRuntime) return;

  const create = dependencies => {
    const {
      documentRef,
      windowRef,
      chromeApi,
      modalId,
      normalizedText,
      currentRouteEncounterId,
      createFeedbackModal,
      sendMessage,
      runtimeMessages,
      closeModal,
      ensureStyles,
      modalDismissWithFocusRestore,
      trapModalFocus,
      setLiveRegion,
    } = dependencies || {};

    if (
      !documentRef ||
      !windowRef ||
      !chromeApi ||
      !modalId ||
      typeof normalizedText !== 'function' ||
      typeof currentRouteEncounterId !== 'function' ||
      typeof createFeedbackModal !== 'function' ||
      typeof sendMessage !== 'function' ||
      !runtimeMessages ||
      typeof closeModal !== 'function' ||
      typeof ensureStyles !== 'function' ||
      typeof modalDismissWithFocusRestore !== 'function' ||
      typeof trapModalFocus !== 'function' ||
      typeof setLiveRegion !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de acciones de medicación HHR.');
    }

    const findPharmaHeading = () => {
      const candidates = documentRef.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,[role="heading"],p,span,div'
      );
      return (
        Array.from(candidates)
          .filter(element => normalizedText(element.textContent) === 'farmacos')
          .sort((a, b) => a.childElementCount - b.childElementCount)[0] || null
      );
    };

    const downloadIndications = async (encId, button) => {
      if (currentRouteEncounterId() !== String(encId || '')) {
        createFeedbackModal({
          title: 'Indicaciones',
          message: 'El episodio cambió. Vuelve a abrir Indicaciones desde el paciente actual.',
          error: true,
        });
        return;
      }
      button.disabled = true;
      const result = await sendMessage({ type: runtimeMessages.INDICATIONS_PRINT_REQUEST, encId });
      button.disabled = false;
      if (!result || result.error) {
        createFeedbackModal({
          title: 'Indicaciones',
          message: (result && result.error) || 'No se pudo descargar el reporte de indicaciones.',
          error: true,
        });
        return;
      }
      createFeedbackModal({
        title: 'Indicaciones',
        message: 'PDF de indicaciones descargado. Ábrelo desde Descargas para imprimir.',
      });
    };

    const hasVisibleNursingRole = () => {
      const roleLabels = documentRef.querySelectorAll('span,p,small,div');
      return Array.from(roleLabels).some(element => {
        const text = normalizedText(element.textContent);
        return (
          text === 'enfermera(o)' ||
          text === 'enfermero(a)' ||
          text === 'enfermera' ||
          text === 'enfermero'
        );
      });
    };

    const findToolbarAnchor = heading => {
      const card =
        heading.closest('[class*="MuiPaper"], [class*="MuiCard"], section, article') ||
        heading.parentElement?.parentElement ||
        documentRef.body;
      const textNodes = card.querySelectorAll('label,span,div,p');
      const suspended = Array.from(textNodes)
        .filter(element => normalizedText(element.textContent).includes('mostrar suspendidos'))
        .sort((a, b) => String(a.textContent || '').length - String(b.textContent || '').length)[0];
      if (!suspended) return heading.parentElement || heading;
      return suspended.closest('label') || suspended;
    };

    const createRegimenQuickDialog = () => {
      const focusReturnTarget = documentRef.activeElement;
      if (!closeModal()) return;
      ensureStyles();
      const root = documentRef.createElement('div');
      root.id = modalId;
      root.innerHTML = `
        <div class="hhr-rx-backdrop" aria-hidden="true"></div>
        <section class="hhr-rx-dialog hhr-rx-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
          <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
          <header class="hhr-rx-header">
            <h2 class="hhr-rx-title" id="hhr-rx-title">Regímenes y BRADEN</h2>
            <p class="hhr-rx-subtitle">PDF global con régimen vigente y escala BRADEN de todos los hospitalizados.</p>
          </header>
          <div class="hhr-rx-body"><div class="hhr-rx-status">Verificando censo…</div></div>
          <footer class="hhr-rx-footer">
            <button class="hhr-rx-action hhr-rx-cancel" type="button">Cancelar</button>
            <button class="hhr-rx-action hhr-rx-action-primary hhr-rx-submit" type="button" disabled>Imprimir PDF global</button>
          </footer>
        </section>
      `;
      documentRef.body.appendChild(root);
      const body = root.querySelector('.hhr-rx-body');
      const submit = root.querySelector('.hhr-rx-submit');
      const cancel = root.querySelector('.hhr-rx-cancel');
      const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
      root.__hhrDismiss = dismiss;
      cancel.addEventListener('click', dismiss);
      root.querySelector('.hhr-rx-close').addEventListener('click', dismiss);
      root.querySelector('.hhr-rx-backdrop').addEventListener('click', dismiss);
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
          return;
        }
        trapModalFocus(root, event);
      });
      root.querySelector('.hhr-rx-close').focus();

      const renderError = message => {
        body.innerHTML = '';
        const error = documentRef.createElement('div');
        error.className = 'hhr-rx-error';
        error.textContent = message;
        body.appendChild(error);
        submit.disabled = true;
      };

      sendMessage({
        type: runtimeMessages.HOSPITALIZED_REGIMEN_OPTIONS_REQUEST,
        currentEncId: '',
      }).then(response => {
        if (!root.isConnected) return;
        if (!response || response.error) {
          renderError((response && response.error) || 'No se pudo leer la lista de hospitalizados.');
          return;
        }
        const patients = Array.isArray(response.patients) ? response.patients : [];
        if (!patients.length) {
          body.innerHTML = '<div class="hhr-rx-status">No hay pacientes hospitalizados disponibles.</div>';
          return;
        }
        const regimenCount = Number.isFinite(Number(response.regimenCount))
          ? Number(response.regimenCount)
          : patients.filter(patient => patient.regimen).length;
        const bradenCount = Number.isFinite(Number(response.bradenCount))
          ? Number(response.bradenCount)
          : patients.filter(patient => patient.braden).length;
        body.innerHTML = '';
        const summary = documentRef.createElement('div');
        summary.className = 'hhr-lab-summary';
        [
          patients.length + (patients.length === 1 ? ' paciente hospitalizado' : ' pacientes hospitalizados'),
          regimenCount + ' con régimen vigente',
          bradenCount + ' con BRADEN',
        ].forEach(text => {
          const stat = documentRef.createElement('span');
          stat.className = 'hhr-lab-stat';
          stat.textContent = text;
          summary.appendChild(stat);
        });
        body.appendChild(summary);
        const blocked =
          Number(response.regimenErrorCount || 0) > 0 ||
          Number(response.unavailableCount || 0) > 0;
        if (blocked) {
          const notice = documentRef.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent =
            'Faltan regímenes o resultados BRADEN por verificar. Cierra y reintenta antes de imprimir.';
          body.appendChild(notice);
        }
        submit.disabled = blocked;
        submit.onclick = async () => {
          submit.disabled = true;
          cancel.disabled = true;
          submit.textContent = 'Preparando PDF…';
          const result = await sendMessage({
            type: runtimeMessages.HOSPITALIZED_REGIMEN_PRINT_REQUEST,
          });
          if (!root.isConnected) return;
          cancel.disabled = false;
          if (!result || result.error) {
            renderError((result && result.error) || 'No se pudo preparar el documento.');
            submit.disabled = false;
            submit.textContent = 'Reintentar impresión';
            return;
          }
          let feedback = body.querySelector('.hhr-rx-print-feedback');
          if (!feedback) {
            feedback = documentRef.createElement('div');
            feedback.className = 'hhr-rx-status hhr-rx-print-feedback';
            body.prepend(feedback);
          }
          setLiveRegion(
            feedback,
            'Se abrió el régimen integrado de ' + result.count + ' pacientes: ' +
              result.regimenCount + ' con régimen vigente y ' + result.bradenCount +
              ' con BRADEN disponible.'
          );
          cancel.textContent = 'Cerrar';
          submit.disabled = false;
          submit.textContent = 'Imprimir nuevamente';
        };
      });
    };

    const FAVORITES_STORAGE_KEY = 'hhrFavorites';
    const readFavorites = () => new Promise(resolve => {
      try {
        chromeApi.storage.local.get(FAVORITES_STORAGE_KEY, stored => {
          const list = stored && Array.isArray(stored[FAVORITES_STORAGE_KEY])
            ? stored[FAVORITES_STORAGE_KEY]
            : null;
          resolve(list);
        });
      } catch (_error) {
        resolve(null);
      }
    });
    const writeFavorites = list => new Promise(resolve => {
      try {
        chromeApi.storage.local.set(
          { [FAVORITES_STORAGE_KEY]: list },
          () => resolve(!chromeApi.runtime.lastError)
        );
      } catch (_error) {
        resolve(false);
      }
    });
    const normalizeFavoriteUrl = raw => {
      const value = String(raw || '').trim();
      if (!value) return '';
      try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
      } catch (_error) {
        return '';
      }
    };

    const createFavoritesDialog = () => {
      const focusReturnTarget = documentRef.activeElement;
      if (!closeModal()) return;
      ensureStyles();
      const root = documentRef.createElement('div');
      root.id = modalId;
      root.innerHTML = `
        <div class="hhr-rx-backdrop" aria-hidden="true"></div>
        <section class="hhr-rx-dialog hhr-rx-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="hhr-rx-title">
          <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
          <header class="hhr-rx-header">
            <h2 class="hhr-rx-title" id="hhr-rx-title">Favoritos</h2>
            <p class="hhr-rx-subtitle">Accesos rápidos a páginas web. Se guardan solo en este navegador.</p>
          </header>
          <div class="hhr-rx-body">
            <div class="hhr-fav-list"></div>
            <div class="hhr-rx-format-title">Agregar favorito</div>
            <div class="hhr-fav-form">
              <input class="hhr-rx-search hhr-fav-name" type="text" maxlength="60" placeholder="Nombre" aria-label="Nombre del favorito">
              <input class="hhr-rx-search hhr-fav-url" type="url" maxlength="300" placeholder="https://…" aria-label="URL del favorito">
              <button class="hhr-rx-action hhr-rx-action-primary hhr-fav-add" type="button">Agregar</button>
            </div>
            <div class="hhr-connection-feedback hhr-fav-feedback" role="status" aria-live="polite"></div>
          </div>
          <footer class="hhr-rx-footer">
            <button class="hhr-rx-action hhr-rx-cancel" type="button">Cerrar</button>
          </footer>
        </section>
      `;
      root.dataset.routeIndependent = 'true';
      documentRef.body.appendChild(root);
      const list = root.querySelector('.hhr-fav-list');
      const nameInput = root.querySelector('.hhr-fav-name');
      const urlInput = root.querySelector('.hhr-fav-url');
      const feedback = root.querySelector('.hhr-fav-feedback');
      const dismiss = modalDismissWithFocusRestore(root, focusReturnTarget);
      root.__hhrDismiss = dismiss;
      root.querySelector('.hhr-rx-cancel').addEventListener('click', dismiss);
      root.querySelector('.hhr-rx-close').addEventListener('click', dismiss);
      root.querySelector('.hhr-rx-backdrop').addEventListener('click', dismiss);
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
          return;
        }
        trapModalFocus(root, event);
      });

      let favorites = [];
      const renderList = () => {
        list.innerHTML = '';
        if (!favorites.length) {
          list.innerHTML = '<div class="hhr-center-empty">Aún no hay favoritos guardados.</div>';
          return;
        }
        favorites.forEach((favorite, index) => {
          const row = documentRef.createElement('div');
          row.className = 'hhr-fav-row';
          const open = documentRef.createElement('button');
          open.type = 'button';
          open.className = 'hhr-fav-open';
          const title = documentRef.createElement('strong');
          title.textContent = favorite.name || favorite.url;
          const meta = documentRef.createElement('span');
          meta.textContent = favorite.url;
          open.append(title, meta);
          open.addEventListener('click', () =>
            windowRef.open(favorite.url, '_blank', 'noopener')
          );
          const remove = documentRef.createElement('button');
          remove.type = 'button';
          remove.className = 'hhr-fav-remove';
          remove.setAttribute('aria-label', 'Eliminar ' + (favorite.name || favorite.url));
          remove.textContent = '×';
          remove.addEventListener('click', async () => {
            favorites.splice(index, 1);
            await writeFavorites(favorites);
            renderList();
          });
          row.append(open, remove);
          list.appendChild(row);
        });
      };

      root.querySelector('.hhr-fav-add').addEventListener('click', async () => {
        const url = normalizeFavoriteUrl(urlInput.value);
        if (!url) {
          setLiveRegion(feedback, 'Ingresa una dirección web válida (http o https).', 'error');
          return;
        }
        favorites.push({
          name: nameInput.value.trim() || url.replace(/^https?:\/\//, ''),
          url,
        });
        const saved = await writeFavorites(favorites);
        nameInput.value = '';
        urlInput.value = '';
        setLiveRegion(
          feedback,
          saved ? 'Favorito guardado.' : 'No se pudo guardar el favorito.',
          saved ? '' : 'error'
        );
        renderList();
        nameInput.focus();
      });

      root.querySelector('.hhr-rx-close').focus();
      readFavorites().then(stored => {
        if (!root.isConnected) return;
        favorites = stored || [
          { name: 'HHR · Sistema Estadístico', url: 'https://testinghhr.netlify.app/' },
        ];
        if (!stored) void writeFavorites(favorites);
        renderList();
      });
    };

    return Object.freeze({
      findPharmaHeading,
      downloadIndications,
      hasVisibleNursingRole,
      findToolbarAnchor,
      createRegimenQuickDialog,
      readFavorites,
      writeFavorites,
      normalizeFavoriteUrl,
      createFavoritesDialog,
    });
  };

  globalThis.HhrMedicationActionsRuntime = Object.freeze({ create });
})();
