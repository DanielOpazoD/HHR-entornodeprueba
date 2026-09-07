export interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    use_fedcm_for_button: boolean;
    auto_select: boolean;
    button_auto_select: boolean;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      width: number;
    }
  ): void;
  cancel(): void;
}

const scriptId = 'google-identity-services';
const getApi = () =>
  (
    window as unknown as {
      google?: { accounts?: { id?: GoogleIdentityApi } };
    }
  ).google?.accounts?.id;

/** Load only on the configured login screen, never during authenticated bootstrap. */
export const loadGoogleIdentityButton = (): Promise<GoogleIdentityApi> => {
  const api = getApi();
  if (api) return Promise.resolve(api);
  return new Promise((resolve, reject) => {
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    const owned = !script;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
    }
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const failed = () => {
      cleanup();
      if (owned) script.remove();
      reject(new Error('No se pudo cargar el selector de Google. Usa el acceso habitual.'));
    };
    const loaded = () => {
      const ready = getApi();
      if (!ready) return failed();
      cleanup();
      resolve(ready);
    };
    const timer = setTimeout(failed, 10_000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (owned) document.head.appendChild(script);
  });
};

export const mountGoogleIdentityButton = (
  api: GoogleIdentityApi,
  element: HTMLElement,
  clientId: string,
  onCredential: (idToken: string, isCurrent: () => boolean) => void | Promise<void>
): (() => void) => {
  let active = true;
  let pending = false;
  api.initialize({
    client_id: clientId,
    use_fedcm_for_button: true,
    auto_select: false,
    button_auto_select: false,
    callback: response => {
      // The rendered Google button owns user activation; no One Tap prompt is started.
      if (!active || pending || !response.credential) return;
      pending = true;
      void Promise.resolve()
        .then(() => {
          if (active) return onCredential(response.credential, () => active);
        })
        .finally(() => {
          pending = false;
        });
    },
  });
  api.renderButton(element, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    width: Math.min(element.clientWidth || 280, 280),
  });
  return () => {
    active = false;
    api.cancel();
    element.replaceChildren();
  };
};
