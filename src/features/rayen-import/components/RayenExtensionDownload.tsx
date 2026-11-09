import React from 'react';
import { Download } from 'lucide-react';
import release from 'virtual:rayen-extension-release';

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
        {detailsRequested && (
          <React.Suspense fallback={<p>Cargando información de la extensión…</p>}>
            <DownloadDetails
              installedVersion={installedVersion}
              verifiedId={verifiedId}
              label={label}
              samePackage={samePackage}
              differentPackage={differentPackage}
              unidentified={unidentified}
              incompatible={incompatible}
              working={working}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
};
