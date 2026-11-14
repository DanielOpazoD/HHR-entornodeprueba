import React from 'react';
import { Download } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import release from 'virtual:rayen-extension-release';
import { SYNC_TONE } from './syncTone';

const DownloadDetails = React.lazy(() => import('./RayenExtensionDownloadDetails'));

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
  const [detailsRequested, setDetailsRequested] = React.useState(false);
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
  const download = (
    <a
      href={`${import.meta.env.BASE_URL}${release.path}`}
      download
      className="mt-3 inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800"
    >
      <Download size={13} aria-hidden="true" /> Descargar ZIP · v{release.version}
    </a>
  );
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        popoverTarget={popoverId}
        onClick={event => {
          setDetailsRequested(true);
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: rect.bottom + 8,
            left: Math.max(16, Math.min(rect.right - 288, window.innerWidth - 304)),
          });
        }}
        aria-label={label}
        className={`flex size-7 cursor-pointer list-none items-center justify-center rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${
          needsReview
            ? SYNC_TONE.review.surface
            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        <Download size={14} aria-hidden="true" />
        {needsReview && (
          <span
            className={`absolute right-0 top-0 size-1.5 rounded-full ${SYNC_TONE.review.dot}`}
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
        {download}
        <a
          href={release.notesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-teal-700 underline"
        >
          Ver cambios de esta versión
        </a>
        {working && (
          <p className={`mt-2 font-medium ${SYNC_TONE.info.text}`}>
            Espera a que termine la sincronización antes de recargar la extensión o las páginas.
          </p>
        )}
        {detailsRequested && (
          <ErrorBoundary
            fallback={
              <p role="alert" className={`mt-2 ${SYNC_TONE.review.text}`}>
                La ayuda todavía no cargó. La descarga sigue disponible.
              </p>
            }
          >
            <React.Suspense fallback={null}>
              <DownloadDetails
                installedVersion={installedVersion}
                verifiedId={verifiedId}
                samePackage={samePackage}
                differentPackage={differentPackage}
                unidentified={unidentified}
                incompatible={incompatible}
              />
            </React.Suspense>
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
};
