/** Presentation adapter for Eloísa's client-side, ten-row worklist renderers. */
(() => {
  'use strict';

  // These two Next route modules use the same JSX runtime. Bind only their
  // local import, leaving React, application stores and the API data untouched.
  const jsxModule = 95155;
  const routes = [
    { id: 25587, path: '/dashboard/encounter-list' },
    { id: 61188, path: '/dashboard/encounter-list-nurse' },
  ];

  // Each native renderer filters this private view, then takes a ten-row
  // slice and maps it into native rows. Keep filtering, order and row objects.
  // Array.filter preserves the subclass on its result via Symbol.species.
  class WorklistRows extends Array {
    slice(start, end) {
      if (Number.isSafeInteger(start) && start >= 0 && start % 10 === 0 && end === start + 10) {
        return Array.from(this);
      }
      return super.slice(...arguments);
    }
  }

  const withWorklistRows = (jsx, route) => (type, props, ...rest) => {
    if (typeof type === 'function' && props && location.pathname.replace(/\/$/, '') === route.path) {
      if (Array.isArray(props.columns)) {
        props = globalThis.HhrWorklistPrintColumn.adapt(jsx, props, route.path);
      } else if (route.id === 25587 && Array.isArray(props.encounterList)) {
        const list = props.encounterList;
        // Interconsultas groups its patients by service and paginates each group.
        const encounters = list.some(group => Array.isArray(group?.patientList))
          ? list.map(group => Array.isArray(group?.patientList)
            ? { ...group, patientList: WorklistRows.from(group.patientList) } : group)
          : WorklistRows.from(list);
        props = { ...props, encounterList: encounters };
      } else if (route.id === 61188) {
        const key = ['incomeEncounterList', 'noveltyEncounterList', 'uneventfulEncounterList', 'recoveredEncounterList']
          .find(name => Array.isArray(props[name]));
        if (key) props = { ...props, [key]: WorklistRows.from(props[key]) };
      }
    }
    return jsx(type, props, ...rest);
  };

  function bindRoute(factory, route) {
    return function(module, exports, require) {
      let nurse;
      const nursing = () => nurse ||= globalThis.HhrNursingWorklist.create(require, () => exports.default);
      const localRequire = new Proxy(require, {
        apply(target, receiver, args) {
          const result = Reflect.apply(target, receiver, args);
          if (route.id === 61188 && globalThis.HhrNursingWorklist) {
            // The native loaders turn an API error into an empty array. Let SWR
            // surface an unavailable source alongside the other nursing rows.
            if (args[0] === 40767) return { ...result, A: async (path, ...options) => {
              const response = await result.A(path, ...options);
              if (/^\/encounter\/(?:novelty|uneventful)NurseList\//.test(path) && !Array.isArray(response?.data)) {
                throw new Error('Lista de cuidados no disponible.');
              }
              return response;
            } };
            if (args[0] === 20063) return nursing().navigation;
            if (args[0] === 65672) return nursing().table;
            if (args[0] === jsxModule && result.jsxs) return { ...result, jsx: withWorklistRows(result.jsx, route),
              jsxs: (...args) => nursing().layout(result.jsxs, ...args) };
          }
          if (args[0] !== jsxModule || typeof result?.jsx !== 'function') return result;
          return { ...result, jsx: withWorklistRows(result.jsx, route) };
        },
      });
      return factory.call(this, module, exports, localRequire);
    };
  }

  // The initial script can load on the login screen or directly on a list.
  // Install before Next executes either route, including later SPA navigation.
  const chunks = self.webpackChunk_N_E ||= [];
  chunks.push([['hhr-continuous-worklists-v1'], {}, require => {
    const modules = require.m;
    if (!modules || !Object.isExtensible(modules)) return;
    for (const route of routes) {
      const wrap = factory => typeof factory === 'function' ? bindRoute(factory, route) : factory;
      if (Object.hasOwn(modules, route.id)) {
        modules[route.id] = wrap(modules[route.id]);
      } else {
        // Once this lazy module arrives, restore a regular registry entry.
        Object.defineProperty(modules, route.id, {
          configurable: true,
          set(factory) {
            Object.defineProperty(modules, route.id, {
              configurable: true, enumerable: true, writable: true, value: wrap(factory),
            });
          },
        });
      }
    }
  }]);
})();
