import React from 'react';
import { Download } from 'lucide-react';
import release from 'virtual:rayen-extension-release';

interface Props {
  installedVersion?: string;
  installedBuildId?: string;
  incompatible: boolean;
  working: boolean;
}

export const RayenExtensionDownload: React.FC<Props> = ({
  installedVersion,
  installedBuildId,
  incompatible,
  working,
}) => {
  const popoverId = React.useId();
  const [position, setPosition] = React.useState({ top: 0, left: 16 });
  const verifiedId =
    typeof installedBuildId === 'string' && /^[a-f0-9]{64}$/.test(installedBuildId)
      ? installedBuildId
      : undefined;
  const samePackage = installedVersion === release.version && verifiedId === release.buildId;
  const differentPackage = Boolean(verifiedId && !samePackage);
  const unidentified = Boolean(installedVersion && !verifiedId);
  const needsReview = incompatible || differentPackage || unidentified;
  const label = incompatible
    ? 'Actualización necesaria'
    : differentPackage
      ? 'Paquete diferente'
      : unidentified
        ? 'Identidad sin verificar'
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
          needsReview
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        <Download size={14} aria-hidden="true" />
        {needsReview && (
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
        <p className="mt-1">Detectada: {installedVersion ?? 'sin reporte'}</p>
        <p title={verifiedId}>
          Paquete instalado: {verifiedId?.slice(0, 12) ?? 'sin identificador'}
        </p>
        <p className="mt-1" title={release.buildId}>
          Publicada: {release.version} · Paquete {release.buildId.slice(0, 12)}
        </p>
        {samePackage && (
          <p className="mt-2 text-teal-700">El identificador coincide con el publicado.</p>
        )}
        {(differentPackage || unidentified) && (
          <p className="mt-2 text-amber-700">
            {differentPackage
              ? 'El paquete instalado es distinto del publicado.'
              : 'Esta extensión no informa una identidad verificable.'}{' '}
            El número de versión por sí solo no confirma sus funciones. Si usas una variante de
            desarrollo, revisa sus cambios antes de reemplazarla.
          </p>
        )}
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
        <a
          href={release.notesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-teal-700 underline"
        >
          Ver cambios de esta versión
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
          La instalación es manual. La coincidencia se confirma por versión y huella del paquete.
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
