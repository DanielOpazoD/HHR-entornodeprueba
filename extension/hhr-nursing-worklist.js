/** Compose the three native nursing loaders into one table. Eloísa still owns
 * each row, its permissions, mutation handlers, filters and SWR invalidation. */
(() => {
  'use strict';
  const sources = ['Ingresos', 'Con novedad', 'Sin novedad'];
  const activity = ['Estadía', 'Última novedad', 'Última atención'];
  const columnIds = ['location', 'patient', 'hhrPrint', 'diagnosisAdmission', 'crd', 'assignesDoctor', 'isolated', 'activity', 'actions', 'link'];

  function joinTables(jsx, tables) {
    const headers = new Map();
    const children = [];
    const episodes = new Set();
    // When an admission also appears in follow-up, keep the whole follow-up row
    // with its CRD and assignment actions. Native nursing row keys are encounter.id.
    for (const source of [1, 2, 0]) {
      const table = tables[source];
      if (!table) continue;
      for (const col of table.columns) headers.set(col.id, col);
      headers.set('activity', { id: 'activity', label: 'Actividad', style: { width: '10%' } });
      for (const [position, row] of table.children.entries()) {
        const episode = String(row.key ?? '');
        const valid = /^[1-9]\d*$/.test(episode);
        if (valid && episodes.has(episode)) continue;
        if (valid) episodes.add(episode);
        const cells = new Map();
        const native = row.props.children;
        table.columns.forEach(({ id }, index) => cells.set(id, native[index]));
        // The admissions renderer declares an Actions header but emits only
        // the final chart link. Keep that link in its own column.
        if (source === 0 && native.length + 1 === table.columns.length) {
          cells.delete('actions');
          cells.set('link', native.at(-1));
        }
        const detail = cells.get(['stay', 'lastNovelty', '"lastNursePublishDatetime"'][source]);
        if (detail?.props) cells.set('activity', jsx(detail.type, { ...detail.props,
          children: [jsx('small', { className: 'hhr-activity-label', children: activity[source] }, 'label'), detail.props.children] }));
        children.push({ row, cells, key: valid ? episode : source + '-' + position });
      }
    }
    const columns = columnIds.map(id => headers.get(id)).filter(Boolean);
    return { columns, listLenght: children.length, children: children.map(({ row, cells, key }) =>
      jsx(row.type, { ...row.props, children: columns.map(({ id }) => {
        const cell = cells.get(id);
        return cell?.props ? jsx(cell.type, { ...cell.props }, id) : jsx('td', {}, id);
      }) }, key)) };
  }

  function create(require, getPage) {
    const React = require(12115);
    const { jsx } = require(95155);
    const navigation = require(20063);
    const Source = React.createContext(null);
    const Registry = React.createContext(null);
    const Table = require(65672).A;
    function Capture(props) {
      const source = React.useContext(Source);
      const registry = React.useContext(Registry);
      React.useLayoutEffect(() => {
        if (!registry || source == null) return;
        registry.set(source, props);
        return () => registry.set(source, null);
      }, [registry, source, props]);
      return registry && source != null ? null : jsx(Table, props);
    }
    function makeRegistry() {
      let tables = [null, null, null];
      const listeners = new Set();
      return {
        get: () => tables,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        set(i, value) { tables = tables.slice(); tables[i] = value; listeners.forEach(fn => fn()); },
      };
    }
    function Combined({ registry }) {
      const tables = React.useSyncExternalStore(registry.subscribe, registry.get, registry.get);
      const result = joinTables(jsx, tables);
      if (!result.listLenght && !tables.every(Boolean)) return null;
      return jsx(Table, { ...result, currentPage: 1, header: jsx('div', {
        hidden: true, children: 'Pacientes hospitalizados (' + result.listLenght + ')' }) });
    }
    function useSearchParams() {
      const params = navigation.useSearchParams();
      const index = React.useContext(Source);
      if (index == null) return params;
      const local = new URLSearchParams(params);
      local.set('tab', String(index));
      return local;
    }
    class SourceError extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      render() {
        return this.state.failed ? jsx('div', { role: 'alert', children: 'No se pudo cargar la lista de ' + sources[this.props.index].toLowerCase() + '.' }) : this.props.children;
      }
    }
    function Hospitalized({ active, loaded }) {
      const [registry] = React.useState(makeRegistry);
      return jsx('section', { role: 'tabpanel', id: 'hhr-care-panel-0', 'aria-labelledby': 'hhr-care-tab-0',
        className: 'hhr-hospitalized-panel', children: jsx(Registry.Provider, { value: registry, children: [
          ...sources.map((name, index) => jsx(Source.Provider, { value: index,
            children: jsx(SourceError, { index, children: jsx(React.Suspense, {
              fallback: jsx('span', { role: 'status', children: 'Cargando ' + name.toLowerCase() + '…' }),
              children: index === active ? loaded : jsx(getPage(), {}),
            }) }) }, index)),
          jsx(Combined, { registry }, 'table'),
        ] }) });
    }
    function Layout({ type, props }) {
      const source = React.useContext(Source);
      const params = navigation.useSearchParams();
      const router = navigation.useRouter();
      const resetPage = require(575).A(state => state.setCurrentPage);
      const items = props.children;
      if (source != null) return items[2 + source].props.children;
      const active = Number(params.get('tab')) || 0;
      if (active < 0 || active > 3 || !Number.isInteger(active)) return jsx(type, props);
      const discharged = active === 3;
      const tabs = jsx(require(68175).A, {
        value: discharged ? 3 : 0, 'aria-label': 'Gestión de cuidados',
        onChange: (_, value) => {
          const query = new URLSearchParams(params);
          query.set('tab', String(value));
          query.delete('page');
          resetPage(1);
          router.replace(location.pathname + '?' + query);
        },
        children: [[0, 'Pacientes hospitalizados'], [3, 'Egresos']].map(([value, label]) =>
          jsx(require(26466).A, { value, label, id: 'hhr-care-tab-' + value, 'aria-controls': 'hhr-care-panel-' + value,
            sx: { textTransform: 'none', paddingX: 0, mr: 2 } }, value)),
      });
      let panel = React.cloneElement(items[5], { id: 'hhr-care-panel-3', 'aria-labelledby': 'hhr-care-tab-3' });
      if (!discharged) {
        const session = items[2 + active].props.children.props.session;
        const scope = [session.facilityId, session.healthCarePractitionerId, session.healthCarePractitionerRoleId].join('-');
        panel = jsx(Hospitalized, { active, loaded: items[2 + active].props.children }, scope);
      }
      return jsx(type, { ...props, children: [tabs, items[1], panel, ...items.slice(6)] });
    }
    return {
      navigation: { ...navigation, useSearchParams },
      table: { ...require(65672), A: Capture },
      layout(jsxs, type, props, ...rest) {
        const items = props?.children;
        if (!Array.isArray(items) || ![0, 1, 2, 3].every(i => items[i + 2]?.props?.index === i)) return jsxs(type, props, ...rest);
        return jsx(Layout, { type, props }, ...rest);
      },
    };
  }
  globalThis.HhrNursingWorklist = { create, joinTables };
})();
