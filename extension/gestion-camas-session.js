/** Pure helpers for a short-lived Gestión de Camas session kept by the MV3 worker. */
(function (root) {
  'use strict';

  const SESSION_STORAGE_KEY = 'hhrGestionCamasSessionV1';
  const PENDING_WINDOW_STORAGE_KEY = 'hhrGestionCamasPendingWindowV1';
  const EXPIRING_WINDOW_MS = 10 * 60 * 1000;
  const CLOCK_SKEW_MS = 15 * 1000;
  const ALLOWED_API_HOST = 'hospbackend.rayensalud.cl';

  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const authorizationToken = value => cleanText(value);
  const jwtValue = value => authorizationToken(value).replace(/^Bearer\s+/i, '');

  const decodeBase64Url = value => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = root.atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const parseJwtClaims = token => {
    try {
      const parts = jwtValue(token).split('.');
      if (parts.length !== 3) return {};
      const claims = JSON.parse(decodeBase64Url(parts[1]));
      return claims && typeof claims === 'object' ? claims : {};
    } catch (_error) {
      return {};
    }
  };

  const normalizeApiBase = value => {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.hostname !== ALLOWED_API_HOST) return '';
      return url.origin + url.pathname.replace(/\/$/, '');
    } catch (_error) {
      return '';
    }
  };

  const firstClaim = (claims, keys) => {
    for (const key of keys) {
      const value = cleanText(claims && claims[key]);
      if (value) return value;
    }
    return '';
  };

  const sessionIdentity = claims => ({
    fullName: firstClaim(claims, ['name', 'full_name', 'display_name', 'given_name']),
    username: firstClaim(claims, ['preferred_username', 'unique_name', 'upn', 'email', 'sub']),
  });

  const buildSessionRecord = (info, now = Date.now()) => {
    const token = authorizationToken(info && info.token);
    const apiBase = normalizeApiBase(info && info.apiBase);
    if (!token || !apiBase) return null;
    const claims = parseJwtClaims(token);
    const expSeconds = Number(claims.exp);
    const expiresAt = Number.isFinite(expSeconds) && expSeconds > 0
      ? Math.round(expSeconds * 1000)
      : null;
    return {
      token,
      apiBase,
      facId: /^\d+$/.test(String(info && info.facId || '')) ? String(info.facId) : '',
      capturedAt: now,
      lastVerifiedAt: now,
      expiresAt,
      identity: sessionIdentity(claims),
    };
  };

  const isUsable = (record, now = Date.now()) => Boolean(
    record &&
    authorizationToken(record.token) &&
    normalizeApiBase(record.apiBase) &&
    (record.expiresAt == null || Number(record.expiresAt) > now + CLOCK_SKEW_MS)
  );

  const publicStatus = (record, now = Date.now()) => {
    if (!record) {
      return {
        status: 'missing',
        message: 'Gestión de Camas no está conectada.',
        identity: { fullName: '', username: '' },
        expiresAt: null,
        remainingSeconds: null,
        connectionSource: 'none',
      };
    }
    const expiresAt = record.expiresAt == null ? null : Number(record.expiresAt);
    if (!isUsable(record, now)) {
      return {
        status: 'stale',
        message: 'La sesión de Gestión de Camas venció. Vuelve a conectarla.',
        identity: record.identity || { fullName: '', username: '' },
        expiresAt,
        remainingSeconds: expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null,
        connectionSource: 'session',
      };
    }
    const remainingMs = expiresAt ? expiresAt - now : null;
    const expiring = remainingMs !== null && remainingMs <= EXPIRING_WINDOW_MS;
    return {
      status: 'ready',
      message: expiring
        ? 'Gestión de Camas conectada; la sesión vencerá pronto.'
        : expiresAt
          ? 'Gestión de Camas conectada con sesión vigente.'
          : 'Gestión de Camas conectada; Rayen verificará la vigencia al utilizarla.',
      identity: record.identity || { fullName: '', username: '' },
      expiresAt,
      remainingSeconds: remainingMs === null ? null : Math.max(0, Math.floor(remainingMs / 1000)),
      connectionSource: 'session',
      expiring,
    };
  };

  root.HhrGestionCamasSession = {
    SESSION_STORAGE_KEY,
    PENDING_WINDOW_STORAGE_KEY,
    buildSessionRecord,
    isUsable,
    normalizeApiBase,
    parseJwtClaims,
    publicStatus,
  };
})(typeof self !== 'undefined' ? self : globalThis);
