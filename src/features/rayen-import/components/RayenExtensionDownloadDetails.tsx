import React from 'react';
import release from 'virtual:rayen-extension-release';
import { SYNC_TONE } from './syncTone';

interface Props {
  installedVersion?: string;
  verifiedId?: string;
  incompatible: boolean;
}

const RayenExtensionDownloadDetails: React.FC<Props> = ({
  installedVersion,
  verifiedId,
  incompatible,
}) => (
  <>
    <p className="mt-1">Detectada: {installedVersion ?? 'sin reporte'}</p>
    {verifiedId && <p title={verifiedId}>Paquete instalado: {verifiedId.slice(0, 12)}</p>}
    <p className="mt-1" title={release.buildId}>
      Publicada: {release.version} · Paquete {release.buildId.slice(0, 12)}
    </p>
    {incompatible && (
      <p className={`mt-2 ${SYNC_TONE.review.text}`}>
        Instala la versión publicada y vuelve a comprobar la conexión: esta versión ya no es
        compatible.
      </p>
    )}

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
    <p className="mt-2 text-slate-500">La instalación es manual.</p>
  </>
);

export default RayenExtensionDownloadDetails;
