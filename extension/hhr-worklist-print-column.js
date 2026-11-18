/** Render the document column with the same React rows and keys as Eloísa. */
(() => {
  'use strict';
  const documents = [
    ['indications', 'Imprimir indicaciones vigentes de hoy', 'M8 5H5v15h14V5h-3 M9 3h6v4H9z M8 11h8 M8 15h6'],
    ['prescription', 'Imprimir última receta completa', 'M6 17V4h4a4 4 0 0 1 0 8H6 M9 12l9 9 M19 12l-7 9'],
  ];

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
      if (typeof props.href === 'string' && props.component !== 'div') {
        const match = props.href.match(/^(\/dashboard\/encounter-list(?:-nurse)?)\/([1-9]\d*)\/?(?:\?referralGuid=[^#]*)?$/);
        if (match?.[1] === route) ids.add(match[2]);
      }
      visit(props.children);
    }
    visit(cells[1]);
    visit(cells.at(-1));
    return ids.size === 1 ? { encId: [...ids][0] } : {};
  }

  function withChildren(jsx, element, children) {
    return jsx(element.type, { ...element.props, children }, element.key ?? undefined);
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
    return withChildren(jsx, cell, [
      jsx('span', { className: 'hhr-location-service', children: service }, 'service'),
      jsx('strong', { className: 'hhr-location-bed', children: bed }, 'bed'),
    ]);
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

  function patientCell(jsx, cell, editId) {
    // Ficha uses either a plain string or two text children for its "Nombre social" line.
    let social, registered;
    function scan(node) {
      if (Array.isArray(node)) return node.forEach(scan);
      if (!node?.props) return;
      const { children, fontWeight } = node.props;
      if (fontWeight === 'bold' && typeof children === 'string') registered = node;
      const text = Array.isArray(children) && children.every(child => typeof child === 'string') ? children.join('') : children;
      if (typeof text === 'string' && /^Nombre social:\s*\S/i.test(text)) social = { node, name: text.replace(/^Nombre social:\s*/i, '') };
      scan(children);
    }
    scan(cell.props.children);
    function present(node) {
      if (Array.isArray(node)) {
        const next = node.map(present);
        return next.some((child, i) => child !== node[i]) ? next : node;
      }
      if (!node?.props) return node;
      if (node.props.size === 'small' && node.props.label?.toString().trim().toLowerCase() === 'pendiente') return null;
      if (social && registered) {
        if (node === registered) return withChildren(jsx, node, social.name);
        if (node === social.node) return withChildren(jsx, node, 'Nombre registrado: ' + registered.props.children);
      }
      const children = present(node.props.children);
      const current = children === node.props.children ? node : withChildren(jsx, node, children);
      if (!editId || !node.props.href || node.props.component === 'div') return current;
      return jsx('span', { className: 'hhr-patient-name-line', children: [current,
        jsx('button', { type: 'button', 'data-hhr-edit-episode': editId, title: 'Modificar paciente en Gestión de Camas',
          'aria-label': 'Modificar paciente en Gestión de Camas', children: jsx('svg', { viewBox: '0 0 24 24',
            width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
            children: jsx('path', { d: 'M4 20l4-1 12-12-3-3L5 16z M14 7l3 3' }) }) }, 'edit'),
      ] }, node.key ?? 'name');
    }
    return withChildren(jsx, cell, present(cell.props.children));
  }

  const adapt = (jsx, props, route) => {
    const { columns, children: rows } = props;
    if (!Array.isArray(columns) || !Array.isArray(rows) || !Number.isInteger(props.listLenght) ||
        columns[0]?.id !== 'location' || columns[1]?.id !== 'patient') return props;
    const ges = columns.findIndex(column => column.id === 'ges');
    const referral = ges < 0 && columns.some(column => column.id === 'referralReason');
    if (ges < 0 && !referral) return props;
    const index = referral ? 2 : ges;
    if (rows.some(row => !Array.isArray(row?.props?.children) || !row.props.children[index]?.type)) return props;
    const discharge = route === '/dashboard/encounter-list' && columns.some(col => col.id === 'medicalDischargeDatetime');
    const diagnosis = columns.findIndex(column => column.id === 'diagnosisAdmission');
    const doctor = columns.findIndex(column => ['assignment', 'assignesDoctor'].includes(column.id));
    const nextColumns = columns.slice();
    nextColumns.splice(index, referral ? 0 : 1, { id: 'hhrPrint', label: 'Imprimir', style: { width: '1%' } });
    return { ...props, columns: nextColumns, children: rows.map(row => {
      const cells = row.props.children.slice();
      const { encId, patientId } = encounterForRow(cells, discharge, route);
      cells[0] = compactLocation(jsx, cells[0]);
      cells[1] = patientCell(jsx, cells[1], route.endsWith('-nurse') && encId);
      if (diagnosis >= 0) cells[diagnosis] = compactDiagnosis(jsx, cells[diagnosis]);
      if (cells[doctor]?.props) {
        const cell = cells[doctor];
        cells[doctor] = jsx(cell.type, { ...cell.props, 'data-hhr-worklist-doctor': '' }, cell.key ?? undefined);
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
    }) };
  };
  globalThis.HhrWorklistPrintColumn = Object.freeze({ adapt });
})();
