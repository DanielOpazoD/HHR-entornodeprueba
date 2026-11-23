/** Render the document column with the same React rows and keys as Eloísa. */
(() => {
  'use strict';
  const documents = [
    ['indications', 'Imprimir indicaciones vigentes de hoy', 'M8 5H5v15h14V5h-3 M9 3h6v4H9z M8 11h8 M8 15h6'],
    ['prescription', 'Imprimir última receta completa', 'M6 17V4h4a4 4 0 0 1 0 8H6 M9 12l9 9 M19 12l-7 9'],
  ];
  const chartDestination = href => typeof href === 'string'
    ? /^(\/dashboard\/encounter-list(?:-nurse)?)\/([1-9]\d*)\/?(?:\?referralGuid=[^#]*)?$/.exec(href)
    : null;

  function encounterForRow(cells, discharge, route) {
    // Medical discharges have no chart link. Their native discharge actions
    // explicitly receive both patId and encId; the React row key is not an ID.
    if (discharge) {
      const action = cells.at(-1)?.props?.children?.props;
      if (!/^[1-9]\d*$/.test(action?.patId) || !/^[1-9]\d*$/.test(action?.encId)) return {};
      return { encId: String(action.encId), patientId: String(action.patId) };
    }
    const ids = new Set();
    function visit(child) {
      if (Array.isArray(child)) return child.forEach(visit);
      const props = child?.props;
      if (!props) return;
      if (props.component !== 'div') {
        const match = chartDestination(props.href);
        if (match?.[1] === route) ids.add(match[2]);
      }
      visit(props.children);
    }
    visit(cells[1]);
    visit(cells.at(-1));
    const [encId] = ids;
    return ids.size === 1 && /^[1-9]\d{0,15}$/.test(encId) ? { encId } : {};
  }

  function withChildren(jsx, element, children) {
    return jsx(element.type, { ...element.props, children }, element.key ?? undefined);
  }

  // Rows sharing a bed retain their native order and episode keys.
  function bedOrder(service, bed) {
    const code = String(bed ?? '').toUpperCase().replace(/[\s_-]+/g, '');
    const box = /^(?:B(\d+)UEA|BOX(\d+))$/.exec(code);
    if (box) return 20 + Number(box[1] || box[2]);
    if (/urgencia|\bUEA\b/i.test(String(service))) return Number.MAX_SAFE_INTEGER;
    const recovery = /^R([1-4])$/.exec(code);
    if (recovery) return Number(recovery[1]);
    const neo = /^N(?:EO)?([12])$/.exec(code);
    if (neo) return 4 + Number(neo[1]);
    const ward = /^H([1-6])C([12])$/.exec(code);
    return ward ? 6 + (Number(ward[1]) - 1) * 2 + Number(ward[2]) : 19;
  }

  function orderRows(rows) {
    const rank = row => row.props.children[0]?.props?.['data-hhr-bed-order'] ?? 19;
    return rows.sort((a, b) => rank(a) - rank(b));
  }

  function compactLocation(jsx, cell) {
    const parts = cell.props.children;
    if (!Array.isArray(parts)) return cell;
    let service, bed;
    if (parts.length === 5 && parts[1]?.type === 'br' && parts[3]?.type === 'br') {
      [service, , , , bed] = parts;
    } else if (parts.length === 3 && parts.every(part => typeof part?.props?.children === 'string')) {
      service = parts[0].props.children;
      bed = parts[2].props.children;
    } else return cell;
    return jsx(cell.type, { ...cell.props, 'data-hhr-bed-order': bedOrder(service, bed), children: [
      jsx('span', { className: 'hhr-location-service', children: service }, 'service'),
      jsx('strong', { className: 'hhr-location-bed', children: bed }, 'bed'),
    ] }, cell.key ?? undefined);
  }

  function compactDiagnosis(jsx, cell) {
    if (!cell?.props) return cell;
    const content = cell.props.children;
    const text = typeof content === 'string' ? content : content?.props?.children;
    if (typeof text !== 'string') return cell;
    const cleaned = text.replace(/(?:\s*\((?:principal|ingreso|solicitud hospitalizaci[oó]n)\))+\s*$/i, '').trimEnd();
    if (!cleaned || text === cleaned) return cell;
    return withChildren(jsx, cell, typeof content === 'string' ? cleaned : withChildren(jsx, content, cleaned));
  }

  function compactActivity(jsx, cell) {
    const children = cell?.props?.children;
    const value = Array.isArray(children) && children.every(part => typeof part === 'string')
      ? children.join('') : children;
    if (typeof value !== 'string' || !/^\s*Hace\s+/i.test(value)) return cell;
    const elapsed = value.trim().replace(/^Hace\s+/i, '').split(/\s+por\s+/i)[0].trim();
    return withChildren(jsx, cell, elapsed.replace(/(\d+)\s+horas?\b/gi, '$1 h'));
  }

  function renderNovelty(jsx, { linkType, href, title, kind, linkRef, onClick, expanded }) {
    const type = kind === 'indication' ? 'Indicación' : kind === 'evolution' ? 'Evolución' : '';
    const path = kind === 'indication' ? 'M3 2h10v12H3z M5 5h6m-6 3h6m-6 3h3'
      : kind === 'evolution' ? 'M3 2h7l3 3v9H3z M10 2v3h3 M5 10l2 2 4-4' : 'M2 8h3l2-4 2 8 2-4h3';
    return jsx(href ? linkType || 'a' : 'span', {
      'data-hhr-patient-novelty': '', 'data-hhr-novelty-kind': kind,
      ...(href ? { href, ref: linkRef, onClick, 'aria-expanded': expanded,
        'aria-haspopup': onClick ? 'dialog' : undefined,
        'aria-label': onClick ? 'Ver ' + (type.toLowerCase() || 'novedad') + ' médica' : type ? 'Abrir ' + type.toLowerCase() + ' médica en Historial' : 'Abrir última publicación médica en Historial' }
        : { role: 'img', 'aria-label': 'Con novedad' }),
      'data-hhr-novelty-help': title,
      children: jsx('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        children: jsx('path', { d: path }) }),
    }, 'novelty');
  }

  function chartAction(jsx, cell, route, episode) {
    const link = cell?.props?.children;
    const destination = chartDestination(link?.props?.href);
    if (!link?.props?.LinkComponent || link.props.component === 'div' ||
        destination?.[1] !== route || destination[2] !== episode) return cell;
    return withChildren(jsx, cell, jsx(link.type, {
      ...link.props, 'aria-label': 'Abrir ficha clínica', 'data-hhr-rongorongo-link': '',
      children: jsx('span', { className: 'hhr-rongorongo-icon', 'aria-hidden': true }),
    }, link.key ?? undefined));
  }

  function patientCell(jsx, cell, nursing, editId, noveltyTitle, publication, NoveltyLink) {
    let run;
    function present(node) {
      if (Array.isArray(node)) {
        const next = node.map(present);
        return next.some((child, i) => child !== node[i]) ? next : node;
      }
      if (!node?.props) return node;
      if (node.props.size === 'small' && node.props.label?.toString().trim().toLowerCase() === 'pendiente') return null;
      if (nursing && node.props.label === 'Alta médica' && node.props.size === 'small') {
        return jsx(node.type, { ...node.props, 'data-hhr-discharge-chip': '' }, node.key ?? undefined);
      }
      if (nursing && node.props.label === 'Nuevo' && node.props.size === 'small') {
        return jsx(node.type, { ...node.props, 'data-hhr-new-patient-chip': '' }, node.key ?? undefined);
      }
      const text = node.props.children;
      // The medical worklist renders identifier and nickname labels as separate text children.
      const line = Array.isArray(text) && text.every(part => typeof part === 'string') ? text.join('') : text;
      if (typeof line === 'string') {
        if (/^\s*(?:g[eé]nero|nombre social)\s*:/i.test(line)) return null;
        if (/^\s*RUN\s+materno\s*\/\s*progenitor(?:\(a\))?\s*:/i.test(line)) return null;
        if (/^\s*(?:RUN|RUT)\s*:?\s*$/i.test(line)) return null;
        const labeledRun = /^\s*(?:RUN|RUT)\s*:\s*(\d{1,3}(?:\.\d{3}){1,2}|\d{1,9})\s*-?\s*([\dk])\s*$/i.exec(line);
        if (labeledRun && !run) {
          run = labeledRun[1].replace(/\./g, '') + '-' + labeledRun[2].toUpperCase();
          return null;
        }
        const id = line.match(/^\s*n[uú]mero de identificaci[oó]n\s*:\s*(\S.*)$/i);
        if (id || /^\s*pasaporte\s*:\s*\S/i.test(line)) {
          return jsx(node.type, { ...node.props, 'data-hhr-patient-identifier': '',
            children: id ? id[1].trim() : text }, node.key ?? undefined);
        }
      }
      const children = present(text);
      if (children === null && text?.props && typeof node.props.title === 'string') return null;
      const nameRow = Array.isArray(text) && text[0]?.props &&
        Object.hasOwn(text[0].props, 'administrativeSexId') && text[1]?.props?.fontWeight === 'bold';
      const current = nameRow ? jsx(node.type, { ...node.props, 'data-hhr-patient-name-row': '',
        children: [jsx('span', { className: 'hhr-patient-sex-icon', children: children[0] }, 'sex'), ...children.slice(1)],
      }, node.key ?? undefined) : children === text ? node : withChildren(jsx, node, children);
      if (!nursing || !node.props.href) return current;
      const edit = editId && node.props.component !== 'div';
      const novelty = noveltyTitle && /^\/dashboard\/encounter-list-nurse\/([1-9]\d*)\/?$/.exec(node.props.href);
      if (!edit && !novelty) return current;
      const canOpenHistory = novelty && edit && novelty[1] === editId;
      const marker = {
        linkType: node.props.component, title: noveltyTitle,
        href: canOpenHistory ? node.props.href + '#hhr-ultima-publicacion' : undefined,
      };
      return jsx('span', { className: 'hhr-patient-name-line', children: [current,
        novelty && (canOpenHistory && publication && NoveltyLink
          ? jsx(NoveltyLink, { ...marker, episode: editId, ...publication }, 'novelty')
          : renderNovelty(jsx, marker)),
        edit && jsx('button', { type: 'button', 'data-hhr-edit-episode': editId, title: 'Modificar paciente en Gestión de Camas',
          'aria-label': 'Modificar paciente en Gestión de Camas', children: jsx('svg', { viewBox: '0 0 24 24',
            width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
            children: jsx('path', { d: 'M4 20l4-1 12-12-3-3L5 16z M14 7l3 3' }) }) }, 'edit'),
      ] }, node.key ?? 'name');
    }
    const children = present(cell.props.children);
    if (!run) return withChildren(jsx, cell, children);
    return withChildren(jsx, cell, [children, jsx('button', {
      type: 'button', 'data-hhr-copy-run': run, 'aria-label': 'Copiar RUN ' + run, title: 'Copiar RUN', children: run,
    }, 'copy-run')]);
  }

  const adapt = (jsx, props, route, { publications, NoveltyLink } = {}) => {
    const { columns, children: rows } = props;
    if (!Array.isArray(columns) || !Array.isArray(rows) || !Number.isInteger(props.listLenght) ||
        columns[0]?.id !== 'location' || columns[1]?.id !== 'patient') return props;
    const ges = columns.findIndex(column => column.id === 'ges');
    const referral = ges < 0 && columns.some(column => column.id === 'referralReason');
    if (ges < 0 && !referral) return props;
    const index = referral ? 2 : ges;
    if (rows.some(row => !Array.isArray(row?.props?.children) ||
        [0, 1, index].some(column => !row.props.children[column]?.type || !row.props.children[column].props))) return props;
    const discharge = route === '/dashboard/encounter-list' && columns.some(col => col.id === 'medicalDischargeDatetime');
    const diagnosis = columns.findIndex(column => column.id === 'diagnosisAdmission');
    const doctor = columns.findIndex(column => ['assignment', 'assignesDoctor'].includes(column.id));
    const nursing = route.endsWith('-nurse');
    const activity = nursing ? columns.findIndex(col => col.id === 'lastNovelty' ||
      col.id === '"lastNursePublishDatetime"' || /última atención/i.test(col.label)) : -1;
    const hasNovelty = columns[activity]?.id === 'lastNovelty';
    const nextColumns = columns.map(column =>
      column.id === 'actions' && column.label === 'Acciones' ? { ...column, label: '' } : column);
    if (doctor >= 0) {
      const column = nextColumns[doctor];
      nextColumns[doctor] = { ...column, width: '136px', style: { ...column.style, width: '136px' } };
    }
    nextColumns.splice(index, referral ? 0 : 1, { id: 'hhrPrint', label: 'Imprimir', style: { width: '1%' } });
    const adaptedRows = rows.map(row => {
      const cells = row.props.children.slice();
      const { encId, patientId } = encounterForRow(cells, discharge, route);
      if (encId) cells[cells.length - 1] = chartAction(jsx, cells.at(-1), route, encId);
      cells[0] = compactLocation(jsx, cells[0]);
      if (activity >= 0) cells[activity] = compactActivity(jsx, cells[activity]);
      let noveltyTitle;
      if (hasNovelty) {
        const elapsed = cells[activity]?.props?.children;
        noveltyTitle = typeof elapsed === 'string' && /^\d+\s+(?:h|días?|semanas?)$/.test(elapsed)
          ? 'Último cambio médico hace ' + elapsed.replace(/\s+/g, ' ')
          : 'Último cambio médico';
      }
      cells[1] = patientCell(jsx, cells[1], nursing, encId, noveltyTitle, publications?.get(encId), NoveltyLink);
      if (diagnosis >= 0) cells[diagnosis] = compactDiagnosis(jsx, cells[diagnosis]);
      if (cells[doctor]?.props) {
        const cell = cells[doctor];
        cells[doctor] = jsx(cell.type, { ...cell.props, width: '136px', 'data-hhr-worklist-doctor': '' }, cell.key ?? undefined);
      }
      const buttons = documents.map(([kind, label, path]) => jsx('button', {
        type: 'button', 'data-hhr-print-document': kind, disabled: !encId,
        'aria-label': label, title: encId ? label : 'Episodio sin acceso verificable',
        children: jsx('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true, children: jsx('path', { d: path }) }),
      }, kind));
      cells.splice(index, referral ? 0 : 1, jsx('td', { className: 'hhr-worklist-documents',
        'data-hhr-worklist-episode': encId, 'data-hhr-worklist-patient': patientId, children: buttons }, 'hhrPrint'));
      return jsx(row.type, { ...row.props, children: cells }, row.key ?? undefined);
    });
    return { ...props, columns: nextColumns, children: orderRows(adaptedRows) };
  };
  globalThis.HhrWorklistPrintColumn = Object.freeze({ adapt, orderRows, renderNovelty });
})();
