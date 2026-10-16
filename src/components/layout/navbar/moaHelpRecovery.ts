import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

/** Chunk failures can remain cached; reload only after explicit confirmation. */
export const reloadMoaHelp = () => {
  if (
    defaultBrowserWindowRuntime.confirm(
      'Guarda tus cambios antes de recargar la aplicación. ¿Quieres continuar?'
    )
  ) {
    defaultBrowserWindowRuntime.reload();
  }
};
