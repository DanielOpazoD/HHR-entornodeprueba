(function () {
  var FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
  var AUTHENTICATED_SESSION_HINT_KEY = 'hhr_logged_this_session';
  // Startup UX contract:
  // - login: no spinner nuevo ni flash blanco; conservar solo el fondo/login real
  // - rutas internas sin pista de sesion: no cargar imagen de login como superficie temporal
  // - refresh autenticado en modulos: mostrar el mismo chrome real del
  //   modulo origen desde React bootstrap, no una recreacion en index.html
  // - no reintroducir loaders/skeletons/spinners full-screen en esta capa
  var LOGIN_SURFACE_BACKGROUND = {
    color: '#020617',
    image: [
      'linear-gradient(115deg, rgba(15, 23, 42, 0.82) 0%, rgba(15, 23, 42, 0.62) 36%, rgba(15, 23, 42, 0.28) 64%, rgba(255, 255, 255, 0.08) 100%)',
      'radial-gradient(circle at top left, rgba(255, 255, 255, 0.18), transparent 32%)',
      "url('/images/login/hhr-login-day.webp')",
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

  var hasAnySessionHint = hasPersistedFirebaseAuthHint || hasRecentAuthenticatedSessionHint;
  var shouldUseLoginSurface = isLoginSurfacePath && !hasAnySessionHint;

  document.documentElement.dataset.prebootSurface = shouldUseLoginSurface ? 'login' : 'app';
  applyPrebootSurfaceBackground(
    shouldUseLoginSurface ? LOGIN_SURFACE_BACKGROUND : APP_SURFACE_BACKGROUND
  );
})();
