/**
 * hhr-vitals-center.js
 *
 * Owns the Centro HHR vital-signs census, patient detail, and trends. The host
 * content script keeps the shared shell, patient context, and focus orchestration.
 */
(() => {
  'use strict';

  if (globalThis.HhrVitalsCenterRuntime) return;

  const create = dependencies => {
    const {
      vitalsHelper,
      runtimeMessages,
      currentRouteEncounterId,
      normalizedText,
      sendMessage,
      openVitalsView,
    } = dependencies || {};

    if (
      !runtimeMessages ||
      typeof currentRouteEncounterId !== 'function' ||
      typeof normalizedText !== 'function' ||
      typeof sendMessage !== 'function' ||
      typeof openVitalsView !== 'function'
    ) {
      throw new Error('No se pudo inicializar el Centro de Signos Vitales HHR.');
    }

    // Trend chart with real axes: min/mid/max gridlines with values on the left, first/last
    // date-time under the baseline, and a <title> tooltip (value · timestamp) per point.
    const vitalsSparklineSvg = points => {
      const escSvg = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const width = 320;
      const height = 118;
      const padL = 38;
      const padR = 12;
      const padT = 10;
      const padB = 20;
      const values = points.map(point => point.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const x = index => padL + (points.length > 1 ? ((width - padL - padR) / (points.length - 1)) * index : 0);
      const y = value => padT + (height - padT - padB) * (1 - (value - min) / span);
      const formatValue = value => (Number.isInteger(value) ? String(value) : value.toFixed(1));
      const mid = (min + max) / 2;
      const gridline = value => `
        <line x1="${padL}" y1="${y(value).toFixed(1)}" x2="${width - padR}" y2="${y(value).toFixed(1)}"
          stroke="#dbe4e1" stroke-width="1" stroke-dasharray="3 3"></line>
        <text x="${padL - 5}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#7c8886">${formatValue(value)}</text>`;
      const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
      const dots = points.map((point, index) => {
        const fill = point.status === 'alert'
          ? '#c94c43'
          : point.status === 'warn'
            ? '#d8a72e'
            : point.status === 'ungraded' ? '#7c8886' : '#0f938c';
        return `<circle cx="${x(index).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="3" fill="${fill}">
          <title>${escSvg(point.at)} · ${formatValue(point.value)}</title>
        </circle>`;
      }).join('');
      const first = points[0];
      const last = points[points.length - 1];
      return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia">
        ${gridline(max)}${max - min > 1 ? gridline(mid) : ''}${gridline(min)}
        <polyline points="${line}" fill="none" stroke="#0f938c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
        ${dots}
        <text x="${padL}" y="${height - 5}" font-size="8.5" fill="#7c8886">${escSvg(first.at)}</text>
        <text x="${width - padR}" y="${height - 5}" text-anchor="end" font-size="8.5" fill="#7c8886">${escSvg(last.at)}</text>
      </svg>`;
    };

    const renderVitalsCensus = (root, encId) => {
      const main = root.querySelector('.hhr-center-main');
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Signos vitales</h2>
          <input class="hhr-center-search hhr-vitals-search" type="search"
            placeholder="Buscar paciente, RUN o cama" aria-label="Buscar paciente por signos vitales">
          <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
        </div>
        <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo la última toma de los pacientes hospitalizados…</div></div>
      `;
      const content = main.querySelector('.hhr-center-content');
      const search = main.querySelector('.hhr-vitals-search');
      main.querySelector('.hhr-center-refresh').addEventListener('click', () => renderVitalsCensus(root, encId));
      if (!vitalsHelper) {
        content.innerHTML = '<div class="hhr-rx-error">El módulo de signos vitales no quedó cargado. Recarga la extensión y la pestaña.</div>';
        return;
      }
      const requestGeneration = String(Number(root.dataset.vitalsCensusRequestGeneration || 0) + 1);
      root.dataset.vitalsCensusRequestGeneration = requestGeneration;
      sendMessage({
        type: runtimeMessages.VITALS_CENSUS_REQUEST,
        currentEncId: currentRouteEncounterId() || encId || '',
      }).then(response => {
        if (!root.isConnected || root.dataset.activeModule !== 'vitals' ||
            root.dataset.vitalsCensusRequestGeneration !== requestGeneration) return;
        content.innerHTML = '';
        if (!response || response.error) {
          const error = document.createElement('div');
          error.className = 'hhr-rx-error';
          error.textContent = (response && response.error) || 'No se pudieron leer los signos vitales del censo.';
          content.appendChild(error);
          return;
        }
        const patients = Array.isArray(response.patients) ? response.patients : [];
        if (!patients.length) {
          content.innerHTML = '<div class="hhr-center-empty">No hay pacientes hospitalizados disponibles.</div>';
          return;
        }
        const notice = document.createElement('div');
        notice.className = 'hhr-center-notice';
        notice.textContent = 'Última toma disponible por paciente. Haz clic en una fila para revisar todo su historial y sus gráficas.';
        content.appendChild(notice);
        const list = document.createElement('div');
        list.className = 'hhr-vitals-census';
        const metrics = vitalsHelper.VITAL_METRICS.slice(0, 6);
        patients.forEach(patient => {
          const records = vitalsHelper.parseVitalSigns(patient.forms);
          const latest = records[0] || null;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'hhr-vitals-patient' + (patient.unavailableReason ? ' is-unavailable' : '');
          row.disabled = Boolean(patient.unavailableReason);
          row.dataset.search = normalizedText([patient.name, patient.run, patient.bed, patient.service].join(' '));
          const bed = document.createElement('span');
          bed.className = 'hhr-vitals-bed';
          bed.textContent = patient.bed || '—';
          const identity = document.createElement('span');
          identity.className = 'hhr-vitals-patient-id';
          const name = document.createElement('strong');
          name.textContent = patient.name || 'Paciente sin nombre';
          const meta = document.createElement('span');
          meta.textContent = patient.run || 'RUN no disponible';
          const time = document.createElement('span');
          time.className = 'hhr-vitals-patient-time';
          time.textContent = patient.unavailableReason
            ? 'No disponible'
            : latest ? 'Última toma · ' + latest.recordedAt : 'Sin registros';
          identity.append(name, meta, time);
          row.append(bed, identity);
          let cohort = 'unknown';
          if (latest && latest.recordedDate) {
            const parts = latest.recordedDate.split('-').map(Number);
            const referenceDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date('invalid');
            const validReferenceDate =
              referenceDate.getFullYear() === parts[0] &&
              referenceDate.getMonth() === parts[1] - 1 &&
              referenceDate.getDate() === parts[2];
            cohort = validReferenceDate
              ? vitalsHelper.ageCohort(patient.birthDate, referenceDate)
              : 'unknown';
          }
          const values = document.createElement('span');
          values.className = 'hhr-vitals-values';
          metrics.forEach(metric => {
            const value = document.createElement('span');
            value.className = 'hhr-vitals-summary-value' + (latest ? ' is-' + metric.status(latest, cohort) : '');
            const label = document.createElement('span');
            label.textContent = metric.label;
            const reading = document.createElement('strong');
            reading.textContent = latest ? metric.text(latest) || '–' : '–';
            value.append(label, reading);
            values.appendChild(value);
          });
          row.appendChild(values);
          if (!patient.unavailableReason) {
            row.addEventListener('click', () => openVitalsView(root, patient.encounterId, 'detail'));
          }
          list.appendChild(row);
        });
        content.appendChild(list);
        const applyFilter = () => {
          const query = normalizedText(search.value);
          Array.from(list.children).forEach(row => {
            row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
          });
        };
        search.addEventListener('input', applyFilter);
      });
    };

    const renderVitalsCenter = (root, encId, view = 'overview') => {
      if (view !== 'detail') {
        renderVitalsCensus(root, encId);
        return;
      }
      const requestedEncId = String(encId || '');
      root.dataset.selectedEncounterId = requestedEncId;
      const requestGeneration = String(Number(root.dataset.vitalsRequestGeneration || 0) + 1);
      root.dataset.vitalsRequestGeneration = requestGeneration;
      const main = root.querySelector('.hhr-center-main');
      main.innerHTML = `
        <div class="hhr-center-toolbar">
          <h2 class="hhr-center-heading">Signos vitales</h2>
          <button class="hhr-center-action hhr-vitals-all" type="button">Todos los pacientes</button>
          <button class="hhr-center-action hhr-vitals-charts" type="button" aria-pressed="false" hidden>Ver gráficas</button>
          <button class="hhr-center-action hhr-center-refresh" type="button">Actualizar</button>
        </div>
        <div class="hhr-center-content"><div class="hhr-center-empty">Leyendo signos vitales desde Eloísa…</div></div>
      `;
      const content = main.querySelector('.hhr-center-content');
      const chartsToggle = main.querySelector('.hhr-vitals-charts');
      main.querySelector('.hhr-vitals-all').addEventListener('click', () => {
        openVitalsView(root, encId, 'overview');
      });
      main.querySelector('.hhr-center-refresh').addEventListener('click', () => renderVitalsCenter(root, encId, 'detail'));
      if (!vitalsHelper) {
        content.innerHTML = '<div class="hhr-rx-error">El módulo de signos vitales no quedó cargado. Recarga la extensión y la pestaña.</div>';
        return;
      }
      if (!/^\d+$/.test(String(encId || ''))) {
        content.innerHTML = '<div class="hhr-center-empty">Selecciona un paciente con «Cambiar paciente» en la franja superior para revisar sus signos vitales.</div>';
        return;
      }

      Promise.all([
        sendMessage({ type: runtimeMessages.SCALES_REPORT_REQUEST, encId: requestedEncId }),
        sendMessage({ type: runtimeMessages.PATIENT_HEADER_REQUEST, encId: requestedEncId }),
      ]).then(([response, patientResponse]) => {
        if (
          !root.isConnected ||
          root.dataset.activeModule !== 'vitals' ||
          root.dataset.selectedEncounterId !== requestedEncId ||
          root.dataset.vitalsRequestGeneration !== requestGeneration
        ) return;
        if (!response || response.error) {
          content.innerHTML = '';
          const error = document.createElement('div');
          error.className = 'hhr-rx-error';
          error.textContent = (response && response.error) || 'No se pudieron leer los signos vitales.';
          content.appendChild(error);
          return;
        }
        const records = vitalsHelper.parseVitalSigns(response.forms);
        content.innerHTML = '';
        if (!records.length) {
          content.insertAdjacentHTML('beforeend',
            '<div class="hhr-center-empty">No hay signos vitales registrados en este episodio.</div>');
          return;
        }
        const metrics = vitalsHelper.VITAL_METRICS;
        const latest = records[0];
        const birthDate = patientResponse && !patientResponse.error
          ? patientResponse.patient && patientResponse.patient.birthDate
          : '';
        const cohortForRecord = record => {
          const parts = String(record && record.recordedDate || '').split('-').map(Number);
          if (parts.length !== 3 || parts.some(value => !value)) return 'unknown';
          const referenceDate = new Date(parts[0], parts[1] - 1, parts[2]);
          if (
            referenceDate.getFullYear() !== parts[0] ||
            referenceDate.getMonth() !== parts[1] - 1 ||
            referenceDate.getDate() !== parts[2]
          ) return 'unknown';
          return vitalsHelper.ageCohort(birthDate, referenceDate);
        };
        const cohort = cohortForRecord(latest);
        const hasUngradedHistory = records.some(record => cohortForRecord(record) !== 'adult');

        if (hasUngradedHistory) {
          const notice = document.createElement('div');
          notice.className = 'hhr-center-notice';
          notice.textContent = cohort === 'pediatric'
            ? 'Paciente pediátrico: umbrales no evaluados; no se aplican rangos de adulto.'
            : cohort === 'unknown'
              ? 'Edad no verificable: umbrales no evaluados. Actualiza para reintentar la identificación.'
              : 'Las tomas previas a los 18 años o sin fecha verificable se muestran como no evaluadas.';
          content.appendChild(notice);
        }

        const latestHead = document.createElement('div');
        latestHead.className = 'hhr-vitals-section-title';
        const latestTitle = document.createElement('span');
        latestTitle.textContent = 'Última toma';
        const latestMeta = document.createElement('span');
        latestMeta.textContent = latest.recordedAt + (latest.author ? ' · ' + latest.author : '');
        latestHead.append(latestTitle, latestMeta);
        content.appendChild(latestHead);
        const grid = document.createElement('div');
        grid.className = 'hhr-vitals-grid';
        metrics.forEach(metric => {
          const text = metric.text(latest);
          const tile = document.createElement('div');
          tile.className = 'hhr-vitals-tile is-' + metric.status(latest, cohort);
          const label = document.createElement('span');
          label.className = 'hhr-vitals-label';
          label.textContent = metric.label;
          const value = document.createElement('span');
          value.className = 'hhr-vitals-value';
          value.textContent = text || '–';
          const unit = document.createElement('span');
          unit.className = 'hhr-vitals-unit';
          unit.textContent = metric.unit;
          tile.append(label, value, unit);
          grid.appendChild(tile);
        });
        content.appendChild(grid);
        if (latest.observations) {
          const obs = document.createElement('div');
          obs.className = 'hhr-vitals-obs';
          obs.textContent = 'Observaciones: ' + latest.observations;
          content.appendChild(obs);
        }

        const chartsHost = document.createElement('div');
        chartsHost.className = 'hhr-lab-trends hhr-vitals-trends';
        chartsHost.hidden = true;
        content.appendChild(chartsHost);
        const chartMetrics = metrics.filter(metric => metric.key !== 'insulin' && metric.key !== 'painEva');
        const renderCharts = () => {
          chartsHost.innerHTML = '';
          const chronological = records.slice().reverse();
          chartMetrics.forEach(metric => {
            const points = chronological
              .map(record => ({
                value: metric.key === 'pa' ? record.systolic : metric.series(record),
                status: metric.status(record, cohortForRecord(record)),
                at: record.recordedAt,
              }))
              .filter(point => point.value != null);
            if (points.length < 2) return;
            const card = document.createElement('div');
            card.className = 'hhr-lab-trend-card hhr-vitals-trend-card';
            const cardTitle = document.createElement('strong');
            cardTitle.textContent = metric.label + (metric.unit ? ' · ' + metric.unit : '');
            card.appendChild(cardTitle);
            card.insertAdjacentHTML('beforeend', vitalsSparklineSvg(points));
            const lastReading = points[points.length - 1];
            const lastLine = document.createElement('div');
            lastLine.className = 'hhr-lab-trend-labels';
            lastLine.textContent = 'Último: ' + lastReading.value + (metric.unit ? ' ' + metric.unit : '') +
              ' · ' + lastReading.at + ' · ' + points.length + ' tomas';
            card.appendChild(lastLine);
            chartsHost.appendChild(card);
          });
          if (!chartsHost.children.length) {
            chartsHost.innerHTML = '<div class="hhr-center-empty">No hay suficientes tomas para graficar tendencias.</div>';
          }
        };
        chartsToggle.hidden = false;
        chartsToggle.addEventListener('click', () => {
          const show = chartsHost.hidden;
          chartsHost.hidden = !show;
          if (show) renderCharts();
          chartsToggle.setAttribute('aria-pressed', String(show));
          chartsToggle.textContent = show ? 'Ocultar gráficas' : 'Ver gráficas';
        });

        const historyHead = document.createElement('div');
        historyHead.className = 'hhr-vitals-section-title';
        historyHead.innerHTML = `<span>Historial</span><span>${records.length} ${records.length === 1 ? 'toma' : 'tomas'}</span>`;
        content.appendChild(historyHead);
        const table = document.createElement('table');
        table.className = 'hhr-center-table hhr-vitals-table';
        table.innerHTML = `<thead><tr><th>Hora</th>${metrics.map(metric => `<th>${metric.label}</th>`).join('')}</tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        let currentDay = '';
        records.forEach(record => {
          const day = record.recordedAt.slice(0, 10);
          if (day !== currentDay) {
            currentDay = day;
            const dayRow = document.createElement('tr');
            dayRow.className = 'hhr-vitals-day';
            const dayCell = document.createElement('td');
            dayCell.colSpan = metrics.length + 1;
            dayCell.textContent = day;
            dayRow.appendChild(dayCell);
            tbody.appendChild(dayRow);
          }
          const row = document.createElement('tr');
          if (record.observations || record.author) {
            row.title = [record.observations, record.author && 'Registró: ' + record.author]
              .filter(Boolean).join('\n');
          }
          const timeCell = document.createElement('td');
          timeCell.textContent = record.recordedAt.slice(11) || record.recordedAt;
          row.appendChild(timeCell);
          metrics.forEach(metric => {
            const cell = document.createElement('td');
            const status = metric.status(record, cohortForRecord(record));
            if (status !== 'normal') cell.className = 'is-' + status;
            cell.textContent = metric.text(record) || '·';
            row.appendChild(cell);
          });
          tbody.appendChild(row);
        });
        const tableWrap = document.createElement('div');
        tableWrap.className = 'hhr-vitals-table-wrap';
        tableWrap.appendChild(table);
        content.appendChild(tableWrap);
      });
    };

    return Object.freeze({ renderVitalsCenter });
  };

  globalThis.HhrVitalsCenterRuntime = Object.freeze({ create });
})();
