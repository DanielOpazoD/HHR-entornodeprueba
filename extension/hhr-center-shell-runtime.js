/** Shared Centro HHR shell, navigation and patient selector. */
(() => {
  'use strict';

  const PATIENT_BOUND_MODULES = new Set(['lab', 'imaging']);

  const create = dependencies => {
    const {
      modalId,
      closeModal,
      ensureStyles,
      getClinicalGuard,
      runClinicalTransition,
      trapModalFocus,
      currentRouteEncounterId,
      normalizedText,
      sendMessage,
      runtimeMessages,
      openPrescriptionCenter,
      openHospitalizedDocuments,
      openOperationsCenter,
      onCenterDismiss,
      onCenterModuleChange,
    } = dependencies || {};

    if (
      !modalId ||
      typeof closeModal !== 'function' ||
      typeof ensureStyles !== 'function' ||
      typeof getClinicalGuard !== 'function' ||
      typeof runClinicalTransition !== 'function' ||
      typeof trapModalFocus !== 'function' ||
      typeof currentRouteEncounterId !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      !runtimeMessages ||
      typeof openPrescriptionCenter !== 'function' ||
      typeof openHospitalizedDocuments !== 'function' ||
      typeof openOperationsCenter !== 'function'
    ) {
      throw new Error('No se pudo inicializar el shell del Centro HHR.');
    }

    let lastCenterModule = 'home';

    const centerNavMarkup = activeModule => {
      const items = [
        {
          key: 'home', label: 'Inicio', title: 'Inicio · resumen y accesos directos',
          icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
        },
        {
          key: 'recipes', label: 'Rx', title: 'Recetas',
          icon: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
        },
        {
          key: 'lab', label: 'Lab', title: 'Exámenes de laboratorio',
          icon: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M8 15h8"/>',
        },
        {
          key: 'imaging', label: 'Imágenes', title: 'Imágenes',
          icon: '<circle cx="12" cy="12" r="3"/><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
        },
      ];
      const navButton = item => `
        <button class="hhr-center-nav-button${item.session ? ' hhr-center-nav-session' : ''}" type="button" data-module="${item.key}"
          title="${item.title}" aria-label="${item.title}" ${item.key === activeModule ? 'aria-current="page"' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>
        </button>
      `;
      return items.map(navButton).join('') + navButton({
        key: 'settings', label: 'Ajustes', title: 'Ajustes',
        icon: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
      }) + navButton({
        key: 'connection', label: 'Sesión', title: 'Conexiones y sesión', session: true,
        icon: '<circle cx="12" cy="12" r="3"/><path d="M12 4.5V3M12 21v-1.5M19.5 12H21M3 12h1.5M17.3 6.7l1.1-1.1M5.6 18.4l1.1-1.1M17.3 17.3l1.1 1.1M5.6 5.6l1.1 1.1"/>',
      });
    };

    const centerShellMarkup = activeModule => `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog hhr-center-dialog" role="dialog" aria-modal="true" aria-label="Centro HHR">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <div class="hhr-center-layout">
          <header class="hhr-center-header"><img alt="" aria-hidden="true"></header>
          ${PATIENT_BOUND_MODULES.has(activeModule) || activeModule === 'settings' ? '' : `<div class="hhr-center-patientbar" hidden>
            <span class="hhr-patientbar-tag">Paciente</span>
            <strong class="hhr-patientbar-name">—</strong>
            <span class="hhr-patientbar-meta"></span>
            <span class="hhr-patientbar-route" hidden>Distinto al episodio abierto en Eloísa</span>
          </div>`}
          <div class="hhr-center-shell">
            <nav class="hhr-center-nav" aria-label="Herramientas de Eloísa">${centerNavMarkup(activeModule)}</nav>
            <main class="hhr-center-main"></main>
          </div>
        </div>
      </section>
    `;

    const applyCenterShellLogo = root => {
      try {
        root.querySelector('.hhr-center-header img').src = chrome.runtime.getURL('hhr-logo.svg');
      } catch (_error) {
        const img = root.querySelector('.hhr-center-header img');
        if (img) img.remove();
      }
    };

    const openCenterModule = (module, encId, trigger, flow) => {
      const targetModule = module || lastCenterModule;
      const existing = document.getElementById(modalId);
      if (existing?.querySelector('.hhr-center-shell') && existing.dataset.encounterId === (currentRouteEncounterId() || '')) {
        runClinicalTransition(existing, () => switchCenterModule(existing, targetModule, encId, trigger, flow));
        return;
      }
      if (targetModule === 'recipes') openPrescriptionCenter(encId);
      else if (targetModule === 'indications') {
        openHospitalizedDocuments(targetModule, encId);
      } else openOperationsCenter(targetModule, encId, trigger, null, flow);
    };

    const switchCenterModule = (root, module, encId, focusReturnTarget, flow) => {
      if (root && typeof root.__hhrConnectionDispose === 'function') {
        root.__hhrConnectionDispose();
      }
      if (module === 'recipes') openPrescriptionCenter(encId, '', root);
      else if (module === 'indications') {
        openHospitalizedDocuments(module, encId, root);
      } else openOperationsCenter(module, encId, focusReturnTarget, root, flow);
    };

    const wireCenterNavButtons = (root, activeModule, encId, focusReturnTarget) => {
      lastCenterModule = activeModule === 'indications' ? 'recipes' : activeModule;
      root.querySelectorAll('.hhr-center-nav-button').forEach(button => {
        button.addEventListener('click', () => {
          const target = button.dataset.module;
          if (target === activeModule) return;
          runClinicalTransition(root, () =>
            switchCenterModule(root, target, root.dataset.selectedEncounterId || encId, focusReturnTarget)
          );
        });
      });

    };

    const prepareCenterModalRoot = ({ existingRoot = null, activeModule, encId, focusReturnTarget }) => {
      if (!existingRoot && !closeModal()) return null;
      if (existingRoot) globalThis.HhrRequestDrafts?.checkpoint(existingRoot);
      existingRoot?.__hhrDocumentPreview?.dispose();
      ensureStyles();
      const root = existingRoot || document.createElement('div');
      const isNew = !existingRoot;
      if (isNew) {
        root.id = modalId;
        root.__hhrFocusReturnTarget = focusReturnTarget;
        root.__hhrDismiss = () => runClinicalTransition(root, () => {
          if (typeof root.__hhrConnectionDispose === 'function') {
            root.__hhrConnectionDispose();
          }
          root.remove();
          if (typeof onCenterDismiss === 'function') onCenterDismiss();
          const target = root.__hhrFocusReturnTarget;
          if (target && target.isConnected && typeof target.focus === 'function') {
            window.setTimeout(() => target.focus(), 0);
          }
        });
        root.addEventListener('keydown', event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            root.__hhrDismiss();
            return;
          }
          if (root.dataset.panelMode !== 'docked' && root.dataset.minimized !== 'true') trapModalFocus(root, event);
        });
      }
      if (isNew) root.dataset.encounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
      root.dataset.activeModule = activeModule;
      if (typeof onCenterModuleChange === 'function') onCenterModuleChange(activeModule);
      root.innerHTML = centerShellMarkup(activeModule);
      applyCenterShellLogo(root);
      globalThis.HhrCenterPanelRuntime?.attach(root);
      globalThis.HhrCenterPatientContext?.prepare(root, {
        encId, activeModule, currentRouteEncounterId, sendMessage, runtimeMessages,
      });
      getClinicalGuard(root);
      root.querySelector('.hhr-rx-close').addEventListener('click', root.__hhrDismiss);
      root.querySelector('.hhr-rx-backdrop').addEventListener('click', root.__hhrDismiss);
      wireCenterNavButtons(root, activeModule, encId, root.__hhrFocusReturnTarget);
      if (isNew) {
        document.body.appendChild(root);
        root.querySelector('.hhr-rx-close').focus();
      } else {
        root.querySelector('.hhr-center-nav-button[aria-current="page"]')?.focus();
      }
      return root;
    };

    const setupCenterPatientContext = (root, module, initialEncId, renderModule) => {
      if (!PATIENT_BOUND_MODULES.has(module)) return;
      root.dataset.selectedEncounterId = initialEncId || '';
      const dialog = root.querySelector('.hhr-center-dialog');
      const picker = document.createElement('div');
      picker.id = 'hhr-order-patient-picker';
      picker.className = 'hhr-patientbar-picker';
      picker.setAttribute('role', 'dialog');
      picker.setAttribute('aria-label', 'Elegir paciente de Eloísa');
      picker.innerHTML = `<input class="hhr-rx-search hhr-patientbar-search" type="search"
        placeholder="Nombre, documento o cama" aria-label="Buscar paciente en el censo">
        <div class="hhr-patientbar-list" role="listbox" aria-label="Pacientes hospitalizados"></div>
        <button type="button" class="hhr-center-action hhr-census-current" hidden>Usar la ficha abierta</button>`;
      const search = picker.querySelector('input');
      const list = picker.querySelector('[role="listbox"]');
      const currentChart = picker.querySelector('.hhr-census-current');
      let trigger, census, pendingCensus, routeId;

      const close = () => {
        trigger?.setAttribute('aria-expanded', 'false');
        trigger?.removeAttribute('aria-controls');
        trigger = null;
        picker.remove();
      };
      const select = encId => {
        runClinicalTransition(root, () => {
          if (!dialog.isConnected) return;
          close();
          if (root.dataset.selectedEncounterId !== encId) {
            const flow = dialog.querySelector('.hhr-flow-tabs [aria-selected="true"]')?.dataset.flow;
            root.dataset.selectedEncounterId = encId;
            renderModule(encId, flow);
          }
          // De Eloísa becomes the printable source only after an explicit choice.
          const field = dialog.querySelector('input[name="hhr-labreq-patient-source"][value="current"]');
          if (field && !field.disabled && !field.checked) {
            field.checked = true;
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
          dialog.querySelector('.hhr-census-trigger')?.focus();
        });
      };
      const showNotice = message => {
        const notice = document.createElement('div');
        notice.className = 'hhr-patientbar-empty';
        notice.setAttribute('role', 'status');
        notice.textContent = message;
        list.replaceChildren(notice);
      };
      const renderList = () => {
        const query = normalizedText(search.value);
        const chartListed = census?.some(patient => String(patient.encounterId) === routeId);
        currentChart.hidden = Boolean(query || !/^\d+$/.test(routeId) || chartListed);
        if (!census) return;
        list.replaceChildren();
        const documentQuery = query.replace(/[.\s-]/g, '');
        for (const patient of census) {
          const encId = String(patient.encounterId || '');
          if (!/^\d+$/.test(encId)) continue;
          const identity = [patient.name, patient.run, patient.bed, patient.service].join(' ');
          const documentMatch = documentQuery && normalizedText(patient.run).replace(/[.\s-]/g, '').includes(documentQuery);
          if (query && !normalizedText(identity).includes(query) && !documentMatch) continue;
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'hhr-patientbar-option';
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(encId === root.dataset.selectedEncounterId && trigger?.getAttribute('aria-pressed') !== 'false'));
          option.innerHTML = '<span class="hhr-rx-bed"></span><span class="hhr-patientbar-option-name"></span><span class="hhr-patientbar-option-meta"></span>';
          const [bed, name, meta] = option.children;
          bed.textContent = patient.bed || '—';
          name.textContent = patient.name || 'Paciente sin nombre';
          meta.textContent = [patient.run, patient.service, patient.isCurrent ? 'Episodio abierto' : ''].filter(Boolean).join(' · ');
          option.addEventListener('click', () => select(encId));
          list.append(option);
        }
        if (!list.childElementCount) showNotice(query ? 'Sin coincidencias en el censo.' : 'No hay pacientes en el censo.');
      };
      const open = async button => {
        trigger = button;
        routeId = String(currentRouteEncounterId() || '');
        button.closest('.hhr-census-anchor').append(picker);
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', picker.id);
        search.value = '';
        search.focus();
        if (!census) {
          renderList();
          showNotice('Cargando censo…');
          pendingCensus ||= sendMessage({ type: runtimeMessages.CENSUS_LIST_REQUEST, currentEncId: routeId })
            .then(response => {
              if (!Array.isArray(response?.patients) || response.error) throw new Error(response?.error || 'No se pudo leer el censo.');
              census = response.patients;
            }).finally(() => { pendingCensus = null; });
          try { await pendingCensus; } catch (error) {
            if (picker.isConnected && trigger === button) showNotice(error.message || 'No se pudo leer el censo.');
            return;
          }
        }
        if (picker.isConnected && trigger === button) renderList();
      };
      currentChart.addEventListener('click', () => {
        if (/^\d+$/.test(routeId) && routeId === String(currentRouteEncounterId() || '')) select(routeId);
      });
      search.addEventListener('input', renderList);
      dialog.addEventListener('click', event => {
        const button = event.target.closest('.hhr-census-trigger');
        if (button && (button !== trigger || !picker.isConnected)) { close(); void open(button); }
        else if (!picker.contains(event.target)) close();
      });
      picker.addEventListener('focusout', event => {
        if (event.relatedTarget !== trigger && !picker.contains(event.relatedTarget)) close();
      });
      picker.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          const button = trigger;
          close(); button?.focus();
          return;
        }
        const options = Array.from(list.querySelectorAll('[role="option"]'));
        if (!options.length) return;
        const index = options.indexOf(event.target);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = event.key === 'ArrowDown' ? Math.min(index + 1, options.length - 1) : (index < 0 ? options.length - 1 : Math.max(0, index - 1));
          options[next].focus();
        } else if (event.key === 'Enter' && event.target === search) {
          event.preventDefault();
          if (options.length === 1) options[0].click();
          else options[0].focus();
        }
      });
    };

    return Object.freeze({
      openCenterModule,
      prepareCenterModalRoot,
      setupCenterPatientContext,
    });
  };

  globalThis.HhrCenterShellRuntime = Object.freeze({ create });
})();
