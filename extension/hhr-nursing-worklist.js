/** Compose the three native nursing loaders into one table. Eloísa still owns
 * each row, its permissions, mutation handlers, filters and SWR invalidation. */
(() => {
  'use strict';
  const sources = ['Ingresos', 'Con novedad', 'Sin novedad'];
  const activity = ['Estadía', 'Última novedad', 'Última atención'];
  const columnIds = ['location', 'patient', 'hhrPrint', 'diagnosisAdmission', 'crd', 'assignesDoctor', 'isolated', 'activity', 'actions', 'link'];
  const handoffColumns = new Set(['location', 'patient', 'hhrPrint', 'diagnosisAdmission', 'activity']);
  const loadingColumns = [
    ['location', 'Ubicación', '8%'], ['patient', 'Paciente', '20%'], ['hhrPrint', 'Imprimir', '1%'],
    ['diagnosisAdmission', 'Diagnóstico Ingreso', '35%'], ['crd', 'CRD', '5%'],
    ['assignesDoctor', 'Médico tratante', '136px'], ['isolated', 'Aislado', '6%'],
    ['activity', 'Entrega de turno', '10%'], ['actions', '', '5%'], ['link', '', '5%'],
  ].map(([id, label, width]) => ({ id, label, style: { width } }));
  const loadingVisibleColumns = loadingColumns.filter(column => column.id !== 'activity');
  const emptySource = { columns: [], children: [] };
  const unsupportedTable = Symbol('unsupported nursing table');

  function joinTables(jsx, tables, handoff = globalThis.HhrNursingHandoffDemo === true) {
    const headers = new Map();
    const children = [];
    const episodes = new Set();
    // When an admission also appears in follow-up, keep the whole follow-up row
    // with its CRD and assignment actions. Only the adapted native link identifies the episode.
    for (const source of [1, 2, 0]) {
      const table = tables[source];
      if (!table) continue;
      for (const col of table.columns) headers.set(col.id, col);
      headers.set('activity', { id: 'activity', label: handoff ? 'Entrega de turno' : 'Actividad', style: { width: '10%' } });
      for (const [position, row] of table.children.entries()) {
        const cells = new Map();
        const native = row.props.children;
        table.columns.forEach(({ id }, index) => cells.set(id, native[index]));
        const episode = cells.get('hhrPrint')?.props['data-hhr-worklist-episode'];
        if (episode && episodes.has(episode)) continue;
        if (episode) episodes.add(episode);
        // The admissions renderer declares an Actions header but emits only
        // the final chart link. Keep that link in its own column.
        if (source === 0 && native.length + 1 === table.columns.length) {
          cells.delete('actions');
          cells.set('link', native.at(-1));
        }
        const detail = cells.get(['stay', 'lastNovelty', '"lastNursePublishDatetime"'][source]);
        if (handoff && episode) {
          cells.set('activity', jsx('td', { className: 'hhr-worklist-handoff', 'data-hhr-handoff-episode': episode }));
        } else if (!handoff && detail?.props) {
          const value = detail.props.children;
          const children = typeof value === 'string' && value.startsWith('Sin registro') ? value : [activity[source], ' ', value];
          cells.set('activity', jsx(detail.type, { ...detail.props, className: 'hhr-worklist-activity', children }));
        }
        children.push({ row, cells, key: episode ? 'episode-' + episode : source + '-' + position + '-' + (row.key ?? '') });
      }
    }
    const columns = columnIds.map(id => headers.get(id)).filter(Boolean);
    const rows = children.map(({ row, cells, key }) =>
      jsx(row.type, { ...row.props, children: columns.map(({ id }) => {
        const cell = cells.get(id);
        return cell?.props ? jsx(cell.type, { ...cell.props }, id) : jsx('td', {}, id);
      }) }, key));
    return { columns, listLenght: rows.length, children: globalThis.HhrWorklistPrintColumn.orderRows(rows) };
  }

  function create(require, getPage) {
    const React = require(12115);
    const { jsx, jsxs } = require(95155);
    const navigation = require(20063);
    const tableModule = require(65672);
    const Table = tableModule?.A;
    const Tab = require(26466)?.A;
    const Tabs = require(68175)?.A;
    const usePageStore = require(575)?.A;
    const request = require(40767)?.A;
    const { adapt, orderRows, renderNovelty } = globalThis.HhrWorklistPrintColumn || {};
    const isComponent = value => typeof value === 'function' || typeof value?.$$typeof === 'symbol';
    const hooks = ['createContext', 'useContext', 'useEffect', 'useLayoutEffect', 'useMemo',
      'useRef', 'useState', 'useSyncExternalStore', 'cloneElement', 'isValidElement', 'Component'];
    if (hooks.some(name => typeof React?.[name] !== 'function') || !React.Fragment || !React.Suspense ||
        ![Table, Tab, Tabs].every(isComponent) ||
        ![jsx, jsxs, navigation?.useSearchParams, navigation?.useRouter, usePageStore,
          request, adapt, orderRows, renderNovelty].every(value => typeof value === 'function')) return null;
    const Source = React.createContext(null);
    const Registry = React.createContext(null);
    const DischargeCountOnly = React.createContext(false);
    const Novelty = React.createContext(null);
    const ReadNovelty = React.createContext(null);
    function NoveltyLink({ episode, publication, publisher, ...marker }) {
      const read = React.useContext(ReadNovelty);
      const linkRef = React.useRef(null);
      const previewRef = React.useRef(null);
      const [expanded, setExpanded] = React.useState(false);
      const [resolved, setResolved] = React.useState();
      React.useEffect(() => {
        const link = linkRef.current;
        if (!read || !link || typeof IntersectionObserver !== 'function') return;
        let active = true;
        const observer = new IntersectionObserver(entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          observer.disconnect();
          const current = () => active && link.isConnected &&
            location.pathname.replace(/\/$/, '') === '/dashboard/encounter-list-nurse';
          void read(episode, publication, publisher, current).then(detail => {
            if (current()) setResolved({ episode, publication, publisher, detail });
          });
        });
        observer.observe(link);
        return () => { active = false; observer.disconnect(); };
      }, [episode, publication, publisher, read]);
      const detail = resolved?.episode === episode && resolved.publication === publication &&
        resolved.publisher === publisher ? resolved.detail : undefined;
      const open = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const preview = previewRef.current;
        if (typeof preview?.showPopover !== 'function') return;
        event.preventDefault();
        if (preview.matches(':popover-open')) { preview.hidePopover(); return; }
        preview.showPopover();
        const anchor = linkRef.current.getBoundingClientRect();
        const { width, height } = preview.getBoundingClientRect();
        const above = anchor.top - height - 8;
        preview.style.left = Math.max(8, Math.min(innerWidth - width - 8, anchor.left)) + 'px';
        preview.style.top = Math.max(8, Math.min(innerHeight - height - 8, above >= 8 ? above : anchor.bottom + 8)) + 'px';
        preview.querySelector('a').focus({ preventScroll: true });
      };
      React.useEffect(() => {
        if (!expanded) return;
        const preview = previewRef.current;
        const close = event => {
          if (!(event.target instanceof Node) || !preview.contains(event.target)) preview.hidePopover();
        };
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
          window.removeEventListener('scroll', close, true);
          window.removeEventListener('resize', close);
        };
      }, [expanded]);
      return jsx(React.Fragment, { children: [
        renderNovelty(jsx, { ...marker, kind: detail?.kind, linkRef, onClick: open, expanded }),
        jsx('div', {
          ref: previewRef, popover: 'auto', className: 'hhr-novelty-preview', role: 'dialog', 'aria-label': 'Novedad médica',
          onToggle: event => setExpanded(event.currentTarget.matches(':popover-open')),
          onKeyDown: event => {
            if (event.key === 'Escape') {
              event.currentTarget.hidePopover();
              linkRef.current?.focus({ preventScroll: true });
            }
          },
          children: [
            jsx('strong', { children: detail?.kind === 'evolution' ? 'Evolución' : detail?.kind === 'indication' ? 'Indicación' : 'Novedad médica' }, 'type'),
            jsx('span', { className: 'hhr-novelty-meta',
              // clinical-clock-allow raw-offset-clock: detail.minute is already converted to Pacific/Easter wall time (YYYY-MM-DDTHH:MM) by hhr-nursing-novelty.js.
              children: [detail?.minute.slice(11), detail?.author].filter(Boolean).join(' · ') || marker.title }, 'meta'),
            jsx('p', { children: detail?.excerpt || 'Abre el Historial para leer la publicación.' }, 'excerpt'),
            jsx('a', { href: detail ? marker.href + '=' + detail.minute : marker.href, children: 'Abrir en Historial ↗' }, 'history'),
          ],
        }, publication),
      ] });
    }
    function Capture(props) {
      const source = React.useContext(Source);
      const registry = React.useContext(Registry);
      const novelty = React.useContext(Novelty);
      const countOnly = React.useContext(DischargeCountOnly);
      const adapted = React.useMemo(() => {
        const publications = novelty && new Map(novelty.flatMap(row => row?.lastPhysicianPublishDatetime
          ? [[String(row.id), { publication: row.lastPhysicianPublishDatetime, publisher: row.legalHcpName }]] : []));
        return adapt(jsx, props, '/dashboard/encounter-list-nurse', { publications, NoveltyLink });
      }, [props, novelty]);
      React.useLayoutEffect(() => {
        if (!registry || source == null) return;
        registry.set(source, source !== 3 && adapted === props ? unsupportedTable : adapted);
        return () => registry.set(source, null);
      }, [registry, source, adapted, props]);
      return registry && source != null && (source !== 3 || countOnly) ? null : jsx(Table, adapted);
    }
    function NativeLoading({ type, props }) {
      const source = React.useContext(Source);
      const countOnly = React.useContext(DischargeCountOnly);
      return source == null || (source === 3 && !countOnly) ? jsx(type, props) : null;
    }
    function SourceFailure({ type, props } = {}) {
      const countOnly = React.useContext(DischargeCountOnly);
      const index = React.useContext(Source);
      const registry = React.useContext(Registry);
      React.useLayoutEffect(() => {
        if (index == null || !registry) return;
        registry.set(index, emptySource);
        return () => registry.set(index, null);
      }, [index, registry]);
      if (index === 3 && countOnly) return null;
      if (index == null || (index === 3 && type)) return jsx(type, props);
      return jsx('p', {
        role: 'alert', className: 'hhr-care-error',
        children: 'No se pudo cargar la lista de ' + (index === 3 ? 'egresos' : sources[index].toLowerCase()) + '.',
      });
    }
    function makeRegistry() {
      let tables = [null, null, null, null];
      const listeners = new Set();
      return {
        get: () => tables,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        set(i, value) { tables = tables.slice(); tables[i] = value; listeners.forEach(fn => fn()); },
      };
    }
    const handoffEnabled = () => document.documentElement.hasAttribute('data-hhr-handoff-enabled');
    const observeHandoff = notify => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-hhr-handoff-enabled'] });
      return () => observer.disconnect();
    };
    function Combined({ registry, onIncompatible }) {
      const tables = React.useSyncExternalStore(registry.subscribe, registry.get, registry.get).slice(0, 3);
      const loading = !tables.every(Boolean);
      const incompatible = tables.includes(unsupportedTable);
      const [expanded, setExpanded] = React.useState(false);
      const [visited, setVisited] = React.useState(false);
      const enabled = React.useSyncExternalStore(observeHandoff, handoffEnabled, handoffEnabled);
      React.useLayoutEffect(() => {
        if (!enabled) { setExpanded(false); setVisited(false); }
      }, [enabled]);
      const lastSettled = React.useRef(null);
      React.useLayoutEffect(() => {
        if (incompatible) onIncompatible(true);
        else if (!loading) lastSettled.current = tables;
      }, [incompatible, loading, tables, onIncompatible]);
      if (incompatible) return null;
      // Keep open editors mounted during refresh, while exposing only the loading table.
      const settled = loading ? lastSettled.current : tables;
      const result = joinTables(jsx, settled || [], enabled);
      const columns = !enabled ? result.columns : expanded ? result.columns.filter(column => handoffColumns.has(column.id)).map(column =>
        column.id === 'activity' ? { ...column, style: { ...column.style, width: '52%' } } : column
      ) : (result.columns.length ? result.columns : loadingColumns).map(column =>
        column.id === 'activity' ? { ...column, style: { ...column.style, display: 'none' } } : column);
      const rows = !enabled ? result.children : result.children.map(row => React.cloneElement(row, { children:
        result.columns.flatMap(({ id }, index) => {
          if (expanded && !handoffColumns.has(id)) return [];
          const cell = row.props.children[index];
          if (id !== 'activity') return [cell];
          const episode = cell.props['data-hhr-handoff-episode'];
          return [React.cloneElement(cell, { hidden: !expanded, children:
            visited && episode
              ? jsx('div', { hidden: !expanded, 'data-hhr-handoff-inline': episode }, 'editor') : null })];
        }),
      }));
      return jsx(React.Fragment, { children: [
        enabled && jsx('div', { className: 'hhr-handoff-toolbar', children: [
          jsx('span', { 'data-hhr-handoff-pending': '', role: 'status', hidden: !expanded }, 'pending'),
          jsx('button', {
            type: 'button', 'data-hhr-handoff-toggle': '', 'aria-expanded': expanded,
            disabled: !expanded && (loading || !result.listLenght),
            onClick: event => {
              if (!event.isTrusted) return;
              setVisited(true);
              setExpanded(previous => !previous);
            },
            children: expanded ? 'Cerrar entrega' : 'Entrega de turno',
          }, 'toggle'),
        ] }, 'handoff-toolbar'),
          loading ? jsx('div', { className: 'hhr-care-loading', role: 'status', 'aria-label': 'Cargando pacientes hospitalizados',
            children: jsx(Table, { columns: loadingVisibleColumns, listLenght: 5, currentPage: 1, children:
              Array.from({ length: 5 }, (_, i) => jsx('tr', { 'aria-hidden': true, children:
                loadingVisibleColumns.map(({ id }) => jsx('td', { children: jsx('span', { className: 'hhr-care-placeholder' }) }, id)),
              }, i)) }) }, 'loading') : null,
        settled && jsx('div', { className: 'hhr-care-results', hidden: loading, children:
          jsx(Table, { ...result, columns, children: rows, currentPage: 1, header: jsx('div', {
            hidden: true, children: 'Pacientes hospitalizados (' + result.listLenght + ')' }) }),
        }, 'patients'),
      ] });
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
        return this.state.failed ? jsx(SourceFailure, {}) : this.props.children;
      }
    }
    function SourcePanel({ registry, index, children }) {
      const tables = React.useSyncExternalStore(registry.subscribe, registry.get, registry.get);
      // Keep each native loader mounted for refreshes, but remove its empty layout from the table's flow.
      return jsx('div', { hidden: Boolean(tables[index] && tables[index] !== emptySource), className: 'hhr-care-source', children });
    }
    function Hospitalized({ active, loaded, registry, onIncompatible }) {
      const [readNovelty] = React.useState(() => globalThis.HhrNursingNovelty?.createReader(async episode => {
        const response = await request('/encounter/' + episode +
          '/getPatientEncounterHistoryReportServer/false/0/0/-14', {
          method: 'GET', headers: { 'Content-Type': 'application/json' },
        });
        return response?.status === 'error' ? undefined : response?.data;
      }));
      const discharged = active === 3;
      const loaders = sources.map((_, index) => jsx(Source.Provider, { value: index,
        children: jsx(SourcePanel, { registry, index, children: jsx(SourceError, { children: jsx(React.Suspense, {
          fallback: null,
          children: index === active ? loaded : jsx(getPage(), {}),
        }) }) }) }, index));
      return discharged
        ? jsx('div', { hidden: true, children: loaders })
        : jsx('section', { role: 'tabpanel', id: 'hhr-care-panel-0', 'aria-labelledby': 'hhr-care-tab-0',
          className: 'hhr-hospitalized-panel', children: [
            ...loaders,
            jsx(ReadNovelty.Provider, { value: readNovelty,
              children: jsx(Combined, { registry, onIncompatible }) }, 'table'),
          ] });
    }
    function WorklistTabs({ registry, discharged, onChange }) {
      const tables = React.useSyncExternalStore(registry.subscribe, registry.get, registry.get);
      const hospitalized = tables.slice(0, 3);
      const hospitalizedCount = hospitalized.every(table => table && table !== emptySource && table !== unsupportedTable)
        ? joinTables(jsx, hospitalized, true).listLenght : undefined;
      const dischargeCount = tables[3]?.listLenght;
      return jsx(Tabs, {
        value: discharged ? 3 : 0, 'aria-label': 'Gestión de cuidados', onChange,
        children: [[0, 'Pacientes hospitalizados', hospitalizedCount], [3, 'Egresos', dischargeCount]].map(([value, label, total]) =>
          jsx(Tab, { value, label: Number.isSafeInteger(total) && total >= 0 ? label + ' (' + total + ')' : label,
            id: 'hhr-care-tab-' + value, 'aria-controls': 'hhr-care-panel-' + value,
            sx: { textTransform: 'none', paddingX: 0, mr: 2 } }, value)),
      });
    }
    function Worklists({ type, props, dischargePanel, active, loaded, onChange, onIncompatible }) {
      const [registry] = React.useState(makeRegistry);
      const discharged = active === 3;
      const discharge = jsx(Source.Provider, { value: 3,
        children: jsx(DischargeCountOnly.Provider, { value: !discharged, children: jsx(SourceError, {
          children: jsx(React.Suspense, { fallback: null, children: discharged ? loaded : jsx(getPage(), {}) }),
        }) }) });
      const hospital = jsx(Hospitalized, { active, loaded, registry, onIncompatible }, 'hospitalized');
      const egresos = discharged
        ? React.cloneElement(dischargePanel, { key:'egresos', id: 'hhr-care-panel-3', 'aria-labelledby': 'hhr-care-tab-3', children: discharge })
        : jsx('div', { hidden: true, children: discharge }, 'egresos-count');
      const items = props.children;
      return jsx(Registry.Provider, { value: registry, children: jsx(type, { ...props,
        children: [jsx(WorklistTabs, { registry, discharged, onChange }, 'tabs'), items[1], hospital, egresos, ...items.slice(6)],
      }) });
    }
    function Layout({ type, props, panels }) {
      const source = React.useContext(Source);
      const params = navigation.useSearchParams();
      const router = navigation.useRouter();
      const resetPage = usePageStore(state => state.setCurrentPage);
      const [useNative, setUseNative] = React.useState(false);
      if (source != null) return panels[source].props.children;
      if (typeof params?.get !== 'function') return jsx(type, props);
      const active = Number(params.get('tab')) || 0;
      if (useNative || active < 0 || active > 3 || !Number.isInteger(active)) return jsx(type, props);
      const discharged = active === 3;
      const loaded = panels[active].props.children;
      const session = loaded?.props?.session;
      if (typeof router?.replace !== 'function' || typeof resetPage !== 'function' ||
          (!discharged && !session?.facilityId)) return jsx(type, props);
      const scope = session?.facilityId
        ? [session.facilityId, session.healthCarePractitionerId, session.healthCarePractitionerRoleId].join('-')
        : 'discharge';
      return jsx(Worklists, { type, props, dischargePanel: panels[3], active, loaded, onIncompatible: setUseNative,
        onChange: (_, value) => {
          const query = new URLSearchParams(params);
          query.set('tab', String(value));
          query.delete('page');
          resetPage(1);
          router.replace(location.pathname + '?' + query);
        },
      }, scope);
    }
    return {
      navigation: { ...navigation, useSearchParams },
      table: { ...tableModule, A: Capture },
      novelty: Novelty,
      loading: NativeLoading,
      failure: SourceFailure,
      layout(jsxs, type, props, ...rest) {
        const items = props?.children;
        if (!Array.isArray(items)) return jsxs(type, props, ...rest);
        const panels = items.slice(2, 6);
        if (panels.length !== 4 || !panels.every((panel, i) => React.isValidElement(panel) && panel.props.index === i)) {
          return jsxs(type, props, ...rest);
        }
        return jsx(Layout, { type, props, panels }, ...rest);
      },
    };
  }
  globalThis.HhrNursingWorklist = { create, joinTables };
})();
