/**
 * hhr-center-shell-runtime.js
 *
 * Owns the shared Centro HHR shell, navigation and patient selector. Clinical
 * modules keep their rendering workflows in their dedicated runtime owners.
 */
(() => {
  'use strict';

  const PATIENT_BOUND_MODULES = new Set(['vitals', 'lab', 'imaging']);

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
      openRegimenQuickDialog,
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
      typeof openOperationsCenter !== 'function' ||
      typeof openRegimenQuickDialog !== 'function'
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
          key: 'handoff', label: 'Turno', title: 'Entrega de turno',
          icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11l2 2 3-4"/>',
        },
        {
          key: 'vitals', label: 'Vitales', title: 'Signos vitales',
          icon: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
        },
        {
          key: 'scores', label: 'Scores', title: 'Instrumentos',
          icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2M14 7l2-2 2 2 4-4"/>',
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
        key: 'connection', label: 'Sesión', title: 'Conexiones y sesión', session: true,
        icon: '<circle cx="12" cy="12" r="3"/><path d="M12 4.5V3M12 21v-1.5M19.5 12H21M3 12h1.5M17.3 6.7l1.1-1.1M5.6 18.4l1.1-1.1M17.3 17.3l1.1 1.1M5.6 5.6l1.1 1.1"/>',
      });
    };

    const centerShellMarkup = activeModule => `
      <div class="hhr-rx-backdrop" aria-hidden="true"></div>
      <section class="hhr-rx-dialog hhr-center-dialog" role="dialog" aria-modal="true" aria-label="Centro HHR">
        <button class="hhr-rx-close" type="button" aria-label="Cerrar">&times;</button>
        <header class="hhr-center-header">
          <img alt="" aria-hidden="true"><strong>Centro HHR</strong>
        </header>
        <div class="hhr-center-patientbar" hidden>
          <span class="hhr-patientbar-tag">Paciente</span>
          <strong class="hhr-patientbar-name">—</strong>
          <span class="hhr-patientbar-meta"></span>
          <span class="hhr-patientbar-route" hidden>Distinto al episodio abierto en Eloísa</span>
          <button class="hhr-center-action hhr-center-action-primary hhr-patientbar-change" type="button" aria-expanded="false">Cambiar paciente ▾</button>
          <div class="hhr-patientbar-picker" hidden>
            <input class="hhr-rx-search hhr-patientbar-search" type="search"
              placeholder="Buscar por paciente, RUN o cama" aria-label="Buscar paciente en el censo">
            <div class="hhr-patientbar-list" role="listbox" aria-label="Pacientes hospitalizados"></div>
          </div>
        </div>
        <div class="hhr-center-shell">
          <nav class="hhr-center-nav" aria-label="Módulos clínicos">${centerNavMarkup(activeModule)}</nav>
          <main class="hhr-center-main"></main>
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

    const openCenterModule = (module, encId, trigger) => {
      const targetModule = module || lastCenterModule;
      if (targetModule === 'recipes') openPrescriptionCenter(encId);
      else if (targetModule === 'regimen' || targetModule === 'indications') {
        openHospitalizedDocuments(targetModule, encId);
      } else openOperationsCenter(targetModule, encId, trigger);
    };

    const switchCenterModule = (root, module, encId, focusReturnTarget) => {
      if (module === 'recipes') openPrescriptionCenter(encId, '', root);
      else if (module === 'regimen' || module === 'indications') {
        openHospitalizedDocuments(module, encId, root);
      } else openOperationsCenter(module, encId, focusReturnTarget, root);
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
      const regimenButton = root.querySelector('.hhr-center-regimen-print');
      if (regimenButton) {
        regimenButton.addEventListener('click', () => {
          runClinicalTransition(root, () => {
            root.__hhrDismiss = null;
            root.remove();
            openRegimenQuickDialog();
          });
        });
      }
    };

    const prepareCenterModalRoot = ({ existingRoot = null, activeModule, encId, focusReturnTarget }) => {
      if (!existingRoot && !closeModal()) return null;
      ensureStyles();
      const root = existingRoot || document.createElement('div');
      const isNew = !existingRoot;
      if (isNew) {
        root.id = modalId;
        root.__hhrFocusReturnTarget = focusReturnTarget;
        root.__hhrDismiss = () => runClinicalTransition(root, () => {
          root.remove();
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
          trapModalFocus(root, event);
        });
      }
      if (isNew) root.dataset.encounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
      root.dataset.activeModule = activeModule;
      root.innerHTML = centerShellMarkup(activeModule);
      applyCenterShellLogo(root);
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
      const bar = root.querySelector('.hhr-center-patientbar');
      if (!bar) return;
      const nameEl = bar.querySelector('.hhr-patientbar-name');
      const metaEl = bar.querySelector('.hhr-patientbar-meta');
      const routeBadge = bar.querySelector('.hhr-patientbar-route');
      const changeButton = bar.querySelector('.hhr-patientbar-change');
      const picker = bar.querySelector('.hhr-patientbar-picker');
      const search = bar.querySelector('.hhr-patientbar-search');
      const list = bar.querySelector('.hhr-patientbar-list');
      if (module === 'connection' || module === 'home') return;
      bar.hidden = false;
      if (!PATIENT_BOUND_MODULES.has(module)) {
        nameEl.textContent = 'Todos los hospitalizados';
        metaEl.textContent = 'Este módulo trabaja sobre el censo completo.';
        changeButton.hidden = true;
        return;
      }

      let selected = /^\d+$/.test(String(initialEncId || '')) ? String(initialEncId) : '';
      root.dataset.selectedEncounterId = selected;
      let censusPatients = [];
      let censusLoaded = false;

      const refreshIdentity = async () => {
        const requestedEncId = selected;
        const routeEncId = currentRouteEncounterId();
        routeBadge.hidden = !requestedEncId || !routeEncId || requestedEncId === routeEncId;
        if (!requestedEncId) {
          nameEl.textContent = 'Sin paciente seleccionado';
          metaEl.textContent = 'Elige un paciente del censo para continuar.';
          return;
        }
        nameEl.textContent = 'Identificando…';
        metaEl.textContent = '';
        const response = await sendMessage({
          type: runtimeMessages.PATIENT_HEADER_REQUEST,
          encId: requestedEncId,
        });
        if (!root.isConnected || root.dataset.selectedEncounterId !== requestedEncId) return;
        if (!response || response.error) {
          nameEl.textContent = 'Paciente no identificado';
          metaEl.textContent = String((response && response.error) || '');
          return;
        }
        const patient = response.patient || {};
        nameEl.textContent = patient.name || 'Paciente sin nombre';
        metaEl.textContent = [
          patient.formattedRun || patient.run,
          [patient.bed, patient.service].filter(Boolean).join(' · '),
          patient.age,
          patient.diagnosis,
        ].filter(Boolean).join('  ·  ');
        metaEl.title = metaEl.textContent;
      };

      const closePicker = () => {
        picker.hidden = true;
        changeButton.setAttribute('aria-expanded', 'false');
      };
      const renderList = () => {
        list.innerHTML = '';
        const query = normalizedText(search.value);
        censusPatients
          .filter(patient => !query ||
            normalizedText([patient.name, patient.run, patient.bed, patient.service].join(' ')).includes(query))
          .forEach(patient => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'hhr-patientbar-option' + (patient.encounterId === selected ? ' is-selected' : '');
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(patient.encounterId === selected));
            const bed = document.createElement('span');
            bed.className = 'hhr-rx-bed';
            bed.textContent = patient.bed || '—';
            const name = document.createElement('span');
            name.className = 'hhr-patientbar-option-name';
            name.textContent = patient.name || 'Paciente sin nombre';
            const meta = document.createElement('span');
            meta.className = 'hhr-patientbar-option-meta';
            meta.textContent = [patient.run, patient.service, patient.isCurrent ? 'Episodio abierto' : '']
              .filter(Boolean).join(' · ');
            option.append(bed, name, meta);
            option.addEventListener('click', () => {
              if (patient.encounterId === selected) {
                closePicker();
                return;
              }
              runClinicalTransition(root, () => {
                closePicker();
                selected = patient.encounterId;
                root.dataset.selectedEncounterId = selected;
                void refreshIdentity();
                renderModule(selected);
              });
            });
            list.appendChild(option);
          });
        if (!list.children.length) {
          const empty = document.createElement('div');
          empty.className = 'hhr-patientbar-empty';
          empty.textContent = 'Sin coincidencias en el censo.';
          list.appendChild(empty);
        }
      };
      const openPicker = async () => {
        picker.hidden = false;
        changeButton.setAttribute('aria-expanded', 'true');
        search.value = '';
        search.focus();
        if (!censusLoaded) {
          list.innerHTML = '<div class="hhr-patientbar-empty">Cargando censo…</div>';
          const response = await sendMessage({
            type: runtimeMessages.CENSUS_LIST_REQUEST,
            currentEncId: currentRouteEncounterId(),
          });
          if (!root.isConnected || picker.hidden) return;
          if (!response || response.error) {
            list.innerHTML = '';
            const failure = document.createElement('div');
            failure.className = 'hhr-patientbar-empty';
            failure.textContent = (response && response.error) || 'No se pudo leer el censo.';
            list.appendChild(failure);
            return;
          }
          censusPatients = Array.isArray(response.patients) ? response.patients : [];
          censusLoaded = true;
        }
        renderList();
      };
      changeButton.addEventListener('click', () => {
        if (picker.hidden) void openPicker();
        else closePicker();
      });
      search.addEventListener('input', renderList);
      root.addEventListener('click', event => {
        if (!picker.hidden && !bar.contains(event.target)) closePicker();
      });
      bar.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !picker.hidden) {
          event.stopPropagation();
          closePicker();
          changeButton.focus();
        }
      });
      void refreshIdentity();
    };

    return Object.freeze({
      openCenterModule,
      prepareCenterModalRoot,
      setupCenterPatientContext,
    });
  };

  globalThis.HhrCenterShellRuntime = Object.freeze({ create });
})();
