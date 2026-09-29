import React from 'react';
import { Download } from 'lucide-react';
import release from 'virtual:rayen-extension-release';

export function isOlderExtensionVersion(installed: string | undefined, available: string): boolean {
  if (!installed || !/^\d+(?:\.\d+){0,3}$/.test(installed)) return false;
  const current = installed.split('.').map(Number);
  const target = available.split('.').map(Number);
  for (let index = 0; index < Math.max(current.length, target.length); index++) {
    const difference = (current[index] ?? 0) - (target[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

interface Props {
  installedVersion?: string;
  incompatible: boolean;
  working: boolean;
}

export const RayenExtensionDownload: React.FC<Props> = ({
  installedVersion,
  incompatible,
  working,
}) => {
  const popoverId = React.useId();
  const [position, setPosition] = React.useState({ top: 0, left: 16 });
  const outdated = isOlderExtensionVersion(installedVersion, release.version);
  const label = incompatible
    ? 'Actualización necesaria'
    : outdated
      ? 'Actualización disponible'
      : 'Descargar extensión';
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        popoverTarget={popoverId}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: rect.bottom + 8,
            left: Math.max(16, Math.min(rect.right - 288, window.innerWidth - 304)),
          });
        }}
        aria-label={label}
        className={`flex size-7 cursor-pointer list-none items-center justify-center rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${
          outdated || incompatible
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        <Download size={14} aria-hidden="true" />
        {(outdated || incompatible) && (
          <span
            className="absolute right-0 top-0 size-1.5 rounded-full bg-amber-500"
            aria-hidden="true"
          />
        )}
      </button>
      <div
        id={popoverId}
        popover="auto"
        style={position}
        className="fixed m-0 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg"
      >
        <p className="font-semibold text-slate-800">{label}</p>
        <p className="mt-1">
          Detectada: {installedVersion ?? 'sin reporte'} · Disponible: {release.version}
        </p>
        {incompatible && (
          <p className="mt-2 text-amber-700">
            La extensión no es compatible. Instala la versión publicada y vuelve a comprobar la
            conexión.
          </p>
        )}
        <a
          href={`${import.meta.env.BASE_URL}${release.path}`}
          download
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800"
        >
          <Download size={13} aria-hidden="true" /> Descargar ZIP · v{release.version}
        </a>
        <ol className="mt-3 list-decimal space-y-1 pl-4">
          <li>
            Descomprime el ZIP y reemplaza el contenido de la carpeta donde instalaste la extensión.
          </li>
          <li>
            En <code>chrome://extensions</code>, pulsa Recargar. Si es la primera instalación, usa
            Cargar descomprimida.
          </li>
          <li>Recarga HHR y las pestañas de Eloísa.</li>
        </ol>
        <p className="mt-2 text-slate-500">
          La instalación es manual. El aviso se quitará al detectar la versión actualizada.
        </p>
        {working && (
          <p className="mt-2 font-medium text-amber-700">
            Espera a que termine la sincronización antes de recargar la extensión o las páginas.
          </p>
        )}
      </div>
    </div>
  );
};
