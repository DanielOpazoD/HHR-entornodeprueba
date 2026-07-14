/**
 * encounter-navigation.js (extension — UMD: importScripts() in the SW, require() in tests)
 *
 * Pure helpers for validating an Eloísa encounter id, building its Ficha Médico route, and
 * choosing the best existing tab to reuse. Keeping these decisions outside background.js makes
 * the navigation contract testable without mocking the Chrome runtime.
 */
(function (root) {
  'use strict';

  var ENCOUNTER_ROUTE_BASE = 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/';
  var FICHAMEDICO_ORIGIN = 'https://fichamedico.rayensalud.cl';

  var normalizeEncounterId = function (value) {
    var normalized = String(value == null ? '' : value).trim();
    return /^\d+$/.test(normalized) ? normalized : '';
  };

  var resolveEncounterRouteBase = function (currentUrl) {
    try {
      var url = new URL(String(currentUrl || ''));
      var routeMatch = url.pathname.match(
        /^\/dashboard\/(encounter-list(?:-nurse)?)(?:\/\d+)?\/?$/
      );
      if (url.origin === FICHAMEDICO_ORIGIN && routeMatch) {
        return FICHAMEDICO_ORIGIN + '/dashboard/' + routeMatch[1] + '/';
      }
    } catch (_error) {
      // Missing or malformed tab URLs fall back to the canonical medical route.
    }
    return ENCOUNTER_ROUTE_BASE;
  };

  var buildEncounterUrl = function (encounterId, currentUrl) {
    var normalized = normalizeEncounterId(encounterId);
    return normalized
      ? resolveEncounterRouteBase(currentUrl) + encodeURIComponent(normalized)
      : '';
  };

  var orderEncounterTabs = function (tabs) {
    return (Array.isArray(tabs) ? tabs : []).slice().sort(function (a, b) {
      var activeDelta = Number(Boolean(b && b.active)) - Number(Boolean(a && a.active));
      if (activeDelta !== 0) return activeDelta;
      return Number((b && b.lastAccessed) || 0) - Number((a && a.lastAccessed) || 0);
    });
  };

  var api = {
    ENCOUNTER_ROUTE_BASE: ENCOUNTER_ROUTE_BASE,
    normalizeEncounterId: normalizeEncounterId,
    resolveEncounterRouteBase: resolveEncounterRouteBase,
    buildEncounterUrl: buildEncounterUrl,
    orderEncounterTabs: orderEncounterTabs,
  };

  root.HhrEncounterNavigation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
