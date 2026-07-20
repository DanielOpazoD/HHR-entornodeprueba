/**
 * hhr-lab-center.js
 *
 * Owns the Centro HHR laboratory results and request surfaces. The host content
 * script keeps the shared shell, navigation, patient context, and transitions.
 */
(() => {
  'use strict';

  const LAB_MAX_SELECTED_EXAMS = 24;

  const create = dependencies => {
    const {
      labHelper,
      requestForms,
      runtimeMessages,
      runClinicalTransition,
      normalizedText,
      sendMessage,
      setLiveRegion,
      fetchPatientHeaderView,
    } = dependencies || {};

    if (
      !runtimeMessages ||
      typeof runClinicalTransition !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof setLiveRegion !== 'function' ||
      typeof fetchPatientHeaderView !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Laboratorio HHR.');
    }
    const copyText = async text => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    };

    const appendLabTrendChart = (container, trend) => {
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('viewBox', '0 0 420 130');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Tendencia de ' + trend.analysis);
      const values = trend.points.map(point => Number(point.value));
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const spread = maxValue - minValue || Math.max(Math.abs(maxValue) * 0.1, 1);
      const xFor = index => 24 + (trend.points.length === 1 ? 0 : index * (372 / (trend.points.length - 1)));
      const yFor = value => 108 - ((value - minValue) / spread) * 82;
      const baseline = document.createElementNS(namespace, 'line');
      baseline.setAttribute('x1', '24');
      baseline.setAttribute('x2', '396');
      baseline.setAttribute('y1', '108');
      baseline.setAttribute('y2', '108');
      baseline.setAttribute('stroke', '#d6dfdd');
      svg.appendChild(baseline);
      const polyline = document.createElementNS(namespace, 'polyline');
      polyline.setAttribute('points', trend.points.map((point, index) => `${xFor(index)},${yFor(point.value)}`).join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', '#15978b');
      polyline.setAttribute('stroke-width', '2');
      svg.appendChild(polyline);
      trend.points.forEach((point, index) => {
        const circle = document.createElementNS(namespace, 'circle');
        circle.setAttribute('cx', String(xFor(index)));
        circle.setAttribute('cy', String(yFor(point.value)));
        circle.setAttribute('r', point.alert ? '4.5' : '3.5');
        circle.setAttribute('fill', point.alert ? '#c94c43' : '#15978b');
        const title = document.createElementNS(namespace, 'title');
        title.textContent = `${point.label}: ${point.value}${trend.unit ? ' ' + trend.unit : ''}`;
        circle.appendChild(title);
        svg.appendChild(circle);
        const label = document.createElementNS(namespace, 'text');
        label.setAttribute('x', String(xFor(index)));
        label.setAttribute('y', String(Math.max(12, yFor(point.value) - 8)));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', point.alert ? '#a43730' : '#43514e');
        label.textContent = String(point.value);
        svg.appendChild(label);
      });
      container.appendChild(svg);
      const labels = document.createElement('div');
      labels.className = 'hhr-lab-trend-labels';
      trend.points.forEach(point => {
        const label = document.createElement('span');
        label.textContent = point.label.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, '');
        labels.appendChild(label);
      });
      container.appendChild(labels);
    };

    const renderLabAnalysis = (host, analysis, activeTab, onTabChange) => {
      host.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'hhr-lab-summary';
      const statValues = [
        [`${analysis.summary.reportCount} informes`, ''],
        [`${analysis.summary.findingCount} resultados`, ''],
        [`${analysis.summary.alertCount} fuera de rango / alertas`, analysis.summary.alertCount ? ' is-alert' : ''],
      ];
      statValues.forEach(item => {
        const stat = document.createElement('span');
        stat.className = 'hhr-lab-stat' + item[1];
        stat.textContent = item[0];
        summary.appendChild(stat);
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'hhr-center-action';
      copy.textContent = 'Copiar tabla';
      copy.addEventListener('click', async () => {
        try {
          await copyText(labHelper.comparisonClipboard(analysis));
          copy.textContent = 'Copiada';
        } catch (_error) {
          copy.textContent = 'No se pudo copiar';
        }
        window.setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copiar tabla'; }, 1800);
      });
      summary.appendChild(copy);
      host.appendChild(summary);

      const tabs = document.createElement('div');
      tabs.className = 'hhr-lab-tabs';
      tabs.setAttribute('role', 'tablist');
      [
        ['comparison', 'Comparación'],
        ['trends', 'Tendencias'],
        ['reports', 'Por informe'],
      ].forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hhr-lab-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(activeTab === item[0]));
        button.textContent = item[1];
        button.addEventListener('click', () => onTabChange(item[0]));
        tabs.appendChild(button);
      });
      host.appendChild(tabs);

      if (activeTab === 'comparison') {
        const wrap = document.createElement('div');
        wrap.className = 'hhr-lab-comparison-wrap';
        const table = document.createElement('table');
        table.className = 'hhr-center-table hhr-lab-comparison';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Variable', ...analysis.columns.map(column => column.label)].forEach(labelText => {
          const th = document.createElement('th');
          th.textContent = labelText;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        analysis.comparison.forEach(row => {
          const tr = document.createElement('tr');
          const name = document.createElement('td');
          const strong = document.createElement('strong');
          strong.textContent = row.analysis;
          const section = document.createElement('span');
          section.className = 'hhr-center-meta';
          section.textContent = row.section;
          name.append(strong, section);
          tr.appendChild(name);
          analysis.columns.forEach(column => {
            const td = document.createElement('td');
            td.className = 'hhr-lab-value';
            const finding = row.values && row.values[column.key];
            if (!finding) {
              td.textContent = '—';
            } else {
              if (finding.alert) td.classList.add('is-alert');
              td.append(document.createTextNode(finding.result + (finding.unit ? ' ' + finding.unit : '')));
              if (finding.refValue) {
                const ref = document.createElement('span');
                ref.className = 'hhr-lab-ref';
                ref.textContent = 'Ref. ' + finding.refValue;
                td.appendChild(ref);
              }
            }
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        host.appendChild(wrap);
        return;
      }

      if (activeTab === 'trends') {
        if (!analysis.trends.length) {
          const empty = document.createElement('div');
          empty.className = 'hhr-center-empty';
          empty.textContent = 'Se necesitan al menos dos valores numéricos del mismo analito para mostrar tendencias.';
          host.appendChild(empty);
          return;
        }
        const trends = document.createElement('div');
        trends.className = 'hhr-lab-trends';
        analysis.trends.forEach(trend => {
          const card = document.createElement('article');
          card.className = 'hhr-lab-trend-card';
          const title = document.createElement('strong');
          title.textContent = trend.analysis + (trend.unit ? ' · ' + trend.unit : '');
          card.appendChild(title);
          appendLabTrendChart(card, trend);
          trends.appendChild(card);
        });
        host.appendChild(trends);
        return;
      }

      analysis.reports.forEach((report, reportIndex) => {
        const details = document.createElement('details');
        details.className = 'hhr-lab-report';
        details.open = reportIndex === 0;
        const reportSummary = document.createElement('summary');
        reportSummary.textContent = `${report.label} · ${report.findings.length} resultados` +
          (report.examNames.length ? ' · ' + report.examNames.join(', ') : '');
        details.appendChild(reportSummary);
        if (report.error) {
          const error = document.createElement('div');
          error.className = 'hhr-rx-error';
          error.textContent = report.error;
          details.appendChild(error);
        }
        const table = document.createElement('table');
        table.className = 'hhr-center-table';
        const tbody = document.createElement('tbody');
        report.findings.forEach(finding => {
          const tr = document.createElement('tr');
          const name = document.createElement('td');
          name.dataset.label = 'Examen';
          name.textContent = finding.analysis;
          const value = document.createElement('td');
          value.dataset.label = 'Resultado';
          value.className = 'hhr-lab-value' + (finding.alert ? ' is-alert' : '');
          value.textContent = finding.result + (finding.unit ? ' ' + finding.unit : '');
          const reference = document.createElement('td');
          reference.dataset.label = 'Referencia';
          reference.textContent = finding.refValue || '—';
          const section = document.createElement('td');
          section.dataset.label = 'Sección';
          section.textContent = finding.section;
          tr.append(name, value, reference, section);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        details.appendChild(table);
        host.appendChild(details);
      });
    };

    const renderLabCenter = (root, encId) => {
      const main = root.querySelector('.hhr-center-main');
      if (!labHelper) {
        main.innerHTML = '<div class="hhr-rx-error">El visor de laboratorio no quedó cargado. Recarga la extensión y la pestaña de Eloísa.</div>';
        return;
      }
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Laboratorio</h2>
          <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de laboratorio">
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="results" aria-selected="true">Ver resultados</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="false">Solicitar exámenes</button>
          </div>
          <input class="hhr-center-search hhr-lab-filter" type="search" placeholder="Filtrar por fecha o examen" aria-label="Filtrar informes">
          <button class="hhr-center-action hhr-lab-select-all" type="button" disabled>Seleccionar todos</button>
          <button class="hhr-center-action hhr-center-action-primary hhr-lab-analyze" type="button" disabled>Analizar</button>
          <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
        </div>
        <div class="hhr-center-content">
          <div class="hhr-lab-patient"><strong>Verificación Syslab</strong><span>Cruzando identidad Eloísa ↔ Syslab…</span><span class="hhr-lab-status">Conectando a Syslab local</span></div>
          <div class="hhr-syslab-access" role="region" aria-label="Acceso seguro a Syslab" hidden>
            <div>
              <strong>Inicio de sesión requerido</strong>
              <span class="hhr-syslab-access-message">Abre el acceso seguro de la extensión para conectarte.</span>
            </div>
            <a class="hhr-center-action hhr-center-action-primary hhr-syslab-access-link" target="_blank" rel="noopener noreferrer">Abrir acceso seguro</a>
          </div>
          <div class="hhr-lab-selection" role="status" aria-live="polite">Buscando exámenes en Syslab…</div>
          <div class="hhr-lab-exam-list"></div>
          <section class="hhr-lab-results" aria-label="Análisis de laboratorio"></section>
        </div>
      `;
      const patientHost = main.querySelector('.hhr-lab-patient');
      const status = main.querySelector('.hhr-lab-selection');
      const list = main.querySelector('.hhr-lab-exam-list');
      const results = main.querySelector('.hhr-lab-results');
      const filter = main.querySelector('.hhr-lab-filter');
      const selectAll = main.querySelector('.hhr-lab-select-all');
      const analyze = main.querySelector('.hhr-lab-analyze');
      const refresh = main.querySelector('.hhr-center-refresh');
      const syslabAccess = main.querySelector('.hhr-syslab-access');
      const syslabAccessLink = main.querySelector('.hhr-syslab-access-link');
      const syslabAccessMessage = main.querySelector('.hhr-syslab-access-message');
      syslabAccessLink.href = chrome.runtime.getURL('syslab-login.html');
      main.querySelector('.hhr-flow-tabs [data-flow="request"]').addEventListener('click', () =>
        renderLabRequestView(root, encId)
      );
      let batchId = '';
      let exams = [];
      let selected = new Set();
      let analysis = null;
      let activeTab = 'comparison';
      let requestGeneration = 0;
      let isAnalyzing = false;

      const setSyslabAccess = (connected, message = '') => {
        syslabAccess.hidden = connected;
        const badge = patientHost.querySelector('.hhr-lab-status');
        if (badge) badge.textContent = connected ? 'Syslab conectado' : 'Syslab requiere acceso';
        syslabAccessMessage.textContent = message || 'Abre el acceso seguro de la extensión para conectarte.';
      };

      const checkSyslabAccess = async () => {
        const report = await sendMessage({ type: runtimeMessages.SYSLAB_STATUS_REQUEST });
        const connected = Boolean(report && !report.error && report.connected);
        setSyslabAccess(connected, report && (report.error || report.message) || 'No se pudo comprobar Syslab.');
        return connected;
      };

      const invalidateLabAnalysis = () => {
        analysis = null;
        activeTab = 'comparison';
        results.innerHTML = '';
      };

      const visibleExams = () => {
        const query = normalizedText(filter.value);
        return exams.filter(exam => !query || normalizedText([
          exam.date, exam.time, exam.origin, ...(exam.exams || []),
        ].join(' ')).includes(query));
      };
      const updateSelection = () => {
        const selectableCount = Math.min(exams.length, LAB_MAX_SELECTED_EXAMS);
        if (!isAnalyzing) {
          status.textContent = exams.length
            ? `${selected.size} de ${exams.length} informes seleccionados · máximo ${LAB_MAX_SELECTED_EXAMS}`
            : 'No hay informes disponibles para este paciente.';
          analyze.textContent = selected.size ? `Analizar ${selected.size}` : 'Analizar';
        }
        analyze.disabled = isAnalyzing || selected.size === 0;
        selectAll.disabled = isAnalyzing || exams.length === 0;
        selectAll.textContent = selectableCount > 0 && selected.size >= selectableCount
          ? 'Quitar todos' : 'Seleccionar todos';
      };
      const renderList = () => {
        list.innerHTML = '';
        const visible = visibleExams();
        if (!visible.length) {
          const empty = document.createElement('div');
          empty.className = 'hhr-center-empty';
          empty.textContent = exams.length ? 'Ningún informe coincide con el filtro.' : 'Syslab no informó exámenes.';
          list.appendChild(empty);
          updateSelection();
          return;
        }
        visible.forEach(exam => {
          const row = document.createElement('label');
          row.className = 'hhr-lab-exam-row';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = selected.has(exam.id);
          checkbox.disabled = isAnalyzing || (!checkbox.checked && selected.size >= LAB_MAX_SELECTED_EXAMS);
          checkbox.addEventListener('change', () => {
            const selectionBefore = selected.has(exam.id);
            if (checkbox.checked && selected.size < LAB_MAX_SELECTED_EXAMS) selected.add(exam.id);
            else if (!checkbox.checked) selected.delete(exam.id);
            if (selected.has(exam.id) !== selectionBefore) invalidateLabAnalysis();
            renderList();
          });
          const copy = document.createElement('span');
          const title = document.createElement('span');
          title.className = 'hhr-lab-exam-title';
          title.textContent = `${exam.date}${exam.time ? ' · ' + exam.time : ''}${exam.origin ? ' · ' + exam.origin : ''}`;
          const names = document.createElement('span');
          names.className = 'hhr-lab-exam-names';
          names.textContent = (exam.exams || []).join(' · ') || 'Informe de laboratorio';
          copy.append(title, names);
          const pdf = document.createElement('button');
          pdf.type = 'button';
          pdf.className = 'hhr-center-action';
          pdf.textContent = 'PDF';
          pdf.disabled = isAnalyzing;
          pdf.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            pdf.disabled = true;
            const response = await sendMessage({ type: runtimeMessages.LAB_PDF_OPEN_REQUEST, batchId, examId: exam.id });
            pdf.disabled = false;
            if (!response || response.error) status.textContent = (response && response.error) || 'No se pudo abrir el PDF.';
          });
          row.append(checkbox, copy, pdf);
          list.appendChild(row);
        });
        updateSelection();
      };
      const showAnalysis = () => {
        if (!analysis) return;
        renderLabAnalysis(results, analysis, activeTab, nextTab => {
          activeTab = nextTab;
          showAnalysis();
        });
      };
      const load = async () => {
        const generation = ++requestGeneration;
        isAnalyzing = false;
        batchId = '';
        exams = [];
        selected = new Set();
        invalidateLabAnalysis();
        if (!/^\d+$/.test(String(encId || ''))) {
          patientHost.querySelector('span').textContent =
            'Selecciona un paciente con «Cambiar paciente» en la franja superior.';
          status.textContent = 'Sin paciente seleccionado';
          list.innerHTML = '';
          results.innerHTML = '';
          analyze.disabled = true;
          selectAll.disabled = true;
          return;
        }
        if (!await checkSyslabAccess()) {
          status.textContent = 'Inicio de sesión requerido';
          list.innerHTML = '<div class="hhr-center-empty">Conecta Syslab para consultar los exámenes de este paciente.</div>';
          results.innerHTML = '';
          analyze.disabled = true;
          selectAll.disabled = true;
          filter.disabled = true;
          refresh.disabled = false;
          return;
        }
        status.textContent = 'Buscando exámenes en Syslab…';
        list.innerHTML = '<div class="hhr-center-empty">Consultando la sesión oficial de Syslab en la red local…</div>';
        results.innerHTML = '';
        analyze.disabled = true;
        selectAll.disabled = true;
        filter.disabled = true;
        refresh.disabled = true;
        const response = await sendMessage({ type: runtimeMessages.LAB_SEARCH_REQUEST, encId: encId || '' });
        if (!root.isConnected || root.dataset.activeModule !== 'lab' || generation !== requestGeneration) return;
        filter.disabled = false;
        refresh.disabled = false;
        if (!response || response.error) {
          status.textContent = 'Syslab no disponible';
          list.innerHTML = '';
          const error = document.createElement('div');
          error.className = 'hhr-rx-error';
          error.textContent = (response && response.error) || 'No se pudo consultar laboratorio.';
          list.appendChild(error);
          return;
        }
        batchId = response.batchId;
        exams = Array.isArray(response.exams) ? response.exams : [];
        selected = new Set(exams.slice(0, 6).map(exam => exam.id));
        analysis = null;
        patientHost.innerHTML = '';
        const patientName = document.createElement('strong');
        patientName.textContent = response.patient && response.patient.name || 'Paciente actual';
        const patientMeta = document.createElement('span');
        patientMeta.textContent = [
          response.patient && response.patient.run,
          response.patient && response.patient.bed ? 'Cama ' + response.patient.bed : '',
          response.patient && response.patient.service,
        ].filter(Boolean).join(' · ');
        const connection = document.createElement('span');
        connection.className = 'hhr-lab-status';
        connection.textContent = 'Syslab conectado directamente';
        patientHost.append(patientName, patientMeta, connection);
        renderList();
      };
      filter.addEventListener('input', renderList);
      selectAll.addEventListener('click', () => {
        const selectionBefore = [...selected].sort().join('|');
        const selectableCount = Math.min(exams.length, LAB_MAX_SELECTED_EXAMS);
        if (selectableCount > 0 && selected.size >= selectableCount) selected.clear();
        else {
          selected.clear();
          exams.slice(0, LAB_MAX_SELECTED_EXAMS).forEach(exam => selected.add(exam.id));
        }
        if ([...selected].sort().join('|') !== selectionBefore) invalidateLabAnalysis();
        renderList();
      });
      analyze.addEventListener('click', async () => {
        const generation = ++requestGeneration;
        const requestBatchId = batchId;
        const requestExamIds = [...selected].sort();
        isAnalyzing = true;
        filter.disabled = true;
        refresh.disabled = true;
        renderList();
        analyze.textContent = 'Leyendo y organizando informes…';
        status.textContent = 'Extrayendo resultados desde los PDF seleccionados. Cada bloque tiene un límite de 25 segundos.';
        const response = await sendMessage({
          type: runtimeMessages.LAB_DETAILS_REQUEST,
          batchId: requestBatchId,
          examIds: requestExamIds,
        });
        const currentExamIds = [...selected].sort();
        if (!root.isConnected || root.dataset.activeModule !== 'lab' || generation !== requestGeneration ||
            requestBatchId !== batchId || requestExamIds.join('|') !== currentExamIds.join('|')) return;
        isAnalyzing = false;
        filter.disabled = false;
        refresh.disabled = false;
        if (!response || response.error) {
          renderList();
          status.textContent = (response && response.error) || 'No se pudieron analizar los informes.';
          analyze.textContent = `Reintentar ${selected.size}`;
          return;
        }
        analysis = response.analysis;
        activeTab = 'comparison';
        updateSelection();
        showAnalysis();
        results.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      refresh.addEventListener('click', load);
      load();
    };

    const renderLabRequestView = (root, encId) => {
      const main = root.querySelector('.hhr-center-main');
      if (!requestForms) return;
      const categories = requestForms.EXAM_CATEGORIES;
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Laboratorio</h2>
          <div class="hhr-rx-tabs hhr-flow-tabs" role="tablist" aria-label="Flujo de laboratorio">
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="results" aria-selected="false">Ver resultados</button>
            <button class="hhr-rx-tab" type="button" role="tab" data-flow="request" aria-selected="true">Solicitar exámenes</button>
          </div>
          <span class="hhr-labreq-count">0 exámenes seleccionados</span>
          <button class="hhr-center-action hhr-center-action-primary hhr-labreq-print" type="button" disabled>Imprimir solicitud</button>
        </div>
        <div class="hhr-center-content hhr-labreq-content">
          <div class="hhr-labreq-meta">
            <div class="hhr-labreq-meta-group" role="radiogroup" aria-label="Procedencia">
              <span class="hhr-labreq-meta-label">Procedencia</span>
              ${requestForms.PROCEDENCIA_OPTIONS.map(option => `
                <label class="hhr-labreq-chip"><input type="radio" name="hhr-labreq-procedencia" value="${option}" ${option === 'Hospitalización' ? 'checked' : ''}>${option}</label>
              `).join('')}
            </div>
            <div class="hhr-labreq-meta-group" role="radiogroup" aria-label="Previsión">
              <span class="hhr-labreq-meta-label">FONASA</span>
              ${requestForms.FONASA_LEVELS.map(level => `
                <label class="hhr-labreq-chip"><input type="radio" name="hhr-labreq-fonasa" value="${level}">${level}</label>
              `).join('')}
              <label class="hhr-labreq-chip"><input type="checkbox" class="hhr-labreq-prais">PRAIS</label>
            </div>
          </div>
          <div class="hhr-labreq-grid">
            ${requestForms.LAB_FORM_COLUMNS.map(column => `
              <div class="hhr-labreq-column">
                ${column.map(id => {
                  const category = categories.find(candidate => candidate.id === id);
                  return `
                    <section class="hhr-labreq-section">
                      <header>${category.name}${category.tube ? `<small>${category.tube}</small>` : ''}</header>
                      ${category.exams.map(exam => `
                        <label class="hhr-labreq-exam"><input type="checkbox" data-key="${category.id}|${exam.replace(/"/g, '&quot;')}">${exam}</label>
                      `).join('')}
                    </section>`;
                }).join('')}
              </div>
            `).join('')}
          </div>
          <div class="hhr-labreq-footer">
            <input class="hhr-center-search hhr-labreq-otros" type="text" maxlength="160" placeholder="Otros exámenes" aria-label="Otros exámenes">
            <input class="hhr-center-search hhr-labreq-medico" type="text" maxlength="120" placeholder="Médico tratante" aria-label="Médico tratante">
          </div>
          <div class="hhr-connection-feedback hhr-labreq-feedback" role="status" aria-live="polite"></div>
        </div>
      `;
      const counter = main.querySelector('.hhr-labreq-count');
      const printButton = main.querySelector('.hhr-labreq-print');
      const feedback = main.querySelector('.hhr-labreq-feedback');
      const othersInput = main.querySelector('.hhr-labreq-otros');
      let patientData = null;
      let patientViewData = null;

      main.querySelector('.hhr-flow-tabs [data-flow="results"]').addEventListener('click', () => {
        runClinicalTransition(root, () => renderLabCenter(root, encId));
      });
      const selectedKeys = () => Array.from(main.querySelectorAll('.hhr-labreq-exam input:checked'))
        .map(input => input.dataset.key);
      const updateCount = () => {
        const count = selectedKeys().length + (othersInput.value.trim() ? 1 : 0);
        counter.textContent = count === 1 ? '1 examen seleccionado' : count + ' exámenes seleccionados';
        printButton.disabled = !patientData || count === 0;
      };
      main.querySelector('.hhr-center-content').addEventListener('change', updateCount);
      main.querySelector('.hhr-center-content').addEventListener('input', updateCount);

      printButton.addEventListener('click', () => {
        if (!patientData) return;
        const fonasa = main.querySelector('input[name="hhr-labreq-fonasa"]:checked');
        const procedencia = main.querySelector('input[name="hhr-labreq-procedencia"]:checked');
        let logoUrl = '';
        try { logoUrl = chrome.runtime.getURL('hhr-logo.svg'); } catch (_error) {}
        const html = requestForms.buildLabRequestPrintHtml({
          patient: {
            name: patientData.name || '',
            run: patientData.formattedRun || patientData.run || '',
            birthDate: patientViewData ? patientViewData.nacimiento : '',
          },
          diagnosis: patientData.diagnosis || '',
          ficha: '',
          procedencia: procedencia ? procedencia.value : 'Hospitalización',
          fonasaLevel: fonasa ? fonasa.value : '',
          prais: main.querySelector('.hhr-labreq-prais').checked,
          selected: selectedKeys(),
          otros: main.querySelector('.hhr-labreq-otros').value.trim(),
          medico: main.querySelector('.hhr-labreq-medico').value.trim(),
          logoUrl,
        });
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          setLiveRegion(feedback, 'El navegador bloqueó la pestaña de impresión. Permite ventanas emergentes.', 'error');
          return;
        }
        let printStarted = false;
        const openPrintDialog = () => {
          if (printStarted || printWindow.closed) return;
          printStarted = true;
          printWindow.focus();
          printWindow.print();
        };
        printWindow.addEventListener('load', openPrintDialog, { once: true });
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        // document.write() does not fire `load` consistently in every supported Chrome build.
        // Keep a guarded fallback so the native dialog still opens exactly once.
        window.setTimeout(openPrintDialog, 300);
        setLiveRegion(feedback, 'Se abrió la solicitud con el diálogo de impresión.');
      });

      if (!/^\d+$/.test(String(encId || ''))) {
        setLiveRegion(feedback,
          'Selecciona un paciente con «Cambiar paciente» en la franja superior para autocompletar la solicitud.');
        return;
      }
      fetchPatientHeaderView(encId).then(result => {
        if (!root.isConnected) return;
        if (result.error) {
          setLiveRegion(feedback, result.error, 'error');
          return;
        }
        patientData = result.patient;
        patientViewData = result.view;
        updateCount();
      });
      updateCount();
    };

    return Object.freeze({ renderLabCenter, renderLabRequestView });
  };

  globalThis.HhrLabCenterRuntime = Object.freeze({ create });
})();
