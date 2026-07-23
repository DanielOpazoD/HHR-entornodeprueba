(function () {
  var FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
  var AUTHENTICATED_SESSION_HINT_KEY = 'hhr_logged_this_session';
  // Startup UX contract:
  // - login: no spinner nuevo ni flash blanco; conservar solo el fondo/login real
  // - rutas internas sin pista de sesion: no cargar imagen de login como superficie temporal
  // - refresh autenticado en modulos: mostrar el mismo chrome real del
  //   modulo origen desde React bootstrap, no una recreacion en index.html
  // - no reintroducir loaders/skeletons/spinners full-screen en esta capa
  // Mirror src/shared/ui/loginBackgroundModeController.ts so the preboot
  // wallpaper matches the DÍA/NOCHE mode the login page will render — no
  // day-image flash for users who chose the night background.
  var resolveLoginBackgroundMode = function () {
    try {
      var storedMode = window.localStorage.getItem('hhr_login_background_mode');
      if (storedMode === 'day' || storedMode === 'night') {
        return storedMode;
      }
    } catch (error) {
      // Fall through to the time-based default.
    }
    var currentHour = new Date().getHours();
    return currentHour >= 8 && currentHour < 20 ? 'day' : 'night';
  };
  var LOGIN_SURFACE_GRADIENTS = {
    day: 'linear-gradient(115deg, rgba(15, 23, 42, 0.82) 0%, rgba(15, 23, 42, 0.62) 36%, rgba(15, 23, 42, 0.28) 64%, rgba(255, 255, 255, 0.08) 100%)',
    night:
      'linear-gradient(115deg, rgba(2, 6, 23, 0.92) 0%, rgba(2, 6, 23, 0.78) 35%, rgba(2, 6, 23, 0.44) 66%, rgba(2, 6, 23, 0.22) 100%)',
  };
  var LOGIN_SURFACE_IMAGES = {
    day: "url('/images/login/hhr-login-day.webp')",
    night: "url('/images/login/hhr-login-night.webp')",
  };
  var loginBackgroundMode = resolveLoginBackgroundMode();
  var LOGIN_SURFACE_BACKGROUND = {
    color: '#020617',
    image: [
      LOGIN_SURFACE_GRADIENTS[loginBackgroundMode],
      'radial-gradient(circle at top left, rgba(255, 255, 255, 0.18), transparent 32%)',
      LOGIN_SURFACE_IMAGES[loginBackgroundMode],
    ].join(','),
    position: 'center, center, center',
    repeat: 'no-repeat, no-repeat, no-repeat',
    size: 'cover, cover, contain',
  };
  var APP_SURFACE_BACKGROUND = {
    color: '#eef4f8',
    image: [
      'linear-gradient(90deg, #0c4a6e 0%, #0369a1 50%, #0c4a6e 100%)',
      'linear-gradient(180deg, #ffffff 0%, #ffffff 100%)',
      'linear-gradient(180deg, #eef4f8 0%, #e8eef5 100%)',
    ].join(','),
    position: 'top left, left 56px, left 100px',
    repeat: 'no-repeat, no-repeat, no-repeat',
    size: '100% 56px, 100% 44px, 100% calc(100vh - 100px)',
  };
  var normalizedPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
  var isLoginSurfacePath = normalizedPath === '' || normalizedPath === 'login';

  var storageContainsPrefix = function (storage, prefix) {
    try {
      for (var index = 0; index < storage.length; index += 1) {
        var key = storage.key(index);
        if (key && key.indexOf(prefix) === 0) {
          return true;
        }
      }
    } catch (error) {
      return false;
    }

    return false;
  };
  var applyPrebootSurfaceBackground = function (surfaceBackground) {
    var rootStyle = document.documentElement.style;
    rootStyle.backgroundColor = surfaceBackground.color;
    rootStyle.backgroundImage = surfaceBackground.image;
    rootStyle.backgroundPosition = surfaceBackground.position;
    rootStyle.backgroundRepeat = surfaceBackground.repeat;
    rootStyle.backgroundSize = surfaceBackground.size;
  };

  var RECENT_MANUAL_LOGOUT_KEY = 'hhr_recent_manual_logout_v1';
  var RECENT_MANUAL_LOGOUT_TTL_MS = 120000;

  var hasRecentManualLogoutMarker = function () {
    try {
      var raw = window.sessionStorage.getItem(RECENT_MANUAL_LOGOUT_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      return (
        parsed &&
        parsed.reason === 'manual' &&
        typeof parsed.at === 'number' &&
        Date.now() - parsed.at <= RECENT_MANUAL_LOGOUT_TTL_MS
      );
    } catch (error) {
      return false;
    }
  };

  var hasPersistedFirebaseAuthHint = false;
  var hasRecentAuthenticatedSessionHint = false;

  try {
    hasPersistedFirebaseAuthHint =
      storageContainsPrefix(window.localStorage, FIREBASE_AUTH_STORAGE_PREFIX) ||
      storageContainsPrefix(window.sessionStorage, FIREBASE_AUTH_STORAGE_PREFIX);
    hasRecentAuthenticatedSessionHint =
      window.sessionStorage.getItem(AUTHENTICATED_SESSION_HINT_KEY) === 'true';
  } catch (error) {
    hasPersistedFirebaseAuthHint = false;
    hasRecentAuthenticatedSessionHint = false;
  }

  // A recent manual logout invalidates stale storage hints so refreshes after
  // signing out land on the login surface, never the authenticated wallpaper.
  var hasAnySessionHint =
    (hasPersistedFirebaseAuthHint || hasRecentAuthenticatedSessionHint) &&
    !hasRecentManualLogoutMarker();
  var shouldUseLoginSurface = isLoginSurfacePath && !hasAnySessionHint;

  document.documentElement.dataset.prebootSurface = shouldUseLoginSurface ? 'login' : 'app';
  applyPrebootSurfaceBackground(
    shouldUseLoginSurface ? LOGIN_SURFACE_BACKGROUND : APP_SURFACE_BACKGROUND
  );

  // First-visit production loads have no cached Firebase config; the blocking
  // fetch to the Netlify Function is the longest serial step of the startup.
  // Kick it off from the preboot layer so it overlaps bundle download/parse.
  // The runtime config loader consumes window.__HHR_EARLY_CONFIG_FETCH__.
  try {
    var isLocalhostRuntime =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (
      !isLocalhostRuntime &&
      typeof window.fetch === 'function' &&
      !window.localStorage.getItem('hhr_firebase_config')
    ) {
      window.__HHR_EARLY_CONFIG_FETCH__ = window
        .fetch('/.netlify/functions/firebase-config?t=' + Date.now() + '&mode=preboot', {
          cache: 'no-store',
        })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
  } catch (error) {
    // Preboot warm-up is best-effort only.
  }
})();
