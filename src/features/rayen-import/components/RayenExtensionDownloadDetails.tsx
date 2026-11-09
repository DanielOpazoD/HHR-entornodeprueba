import React from 'react';
import release from 'virtual:rayen-extension-release';

interface Props {
  download: React.ReactNode;
  installedVersion?: string;
  verifiedId?: string;
  label: string;
  samePackage: boolean;
  differentPackage: boolean;
  unidentified: boolean;
  incompatible: boolean;
  working: boolean;
}

const RayenExtensionDownloadDetails: React.FC<Props> = ({
  download,
  installedVersion,
  verifiedId,
  label,
  samePackage,
  differentPackage,
  unidentified,
  incompatible,
  working,
}) => (
  <>
    <p className="font-semibold text-slate-800">{label}</p>
    <p className="mt-1">Detectada: {installedVersion ?? 'sin reporte'}</p>
    <p title={verifiedId}>Paquete instalado: {verifiedId?.slice(0, 12) ?? 'sin identificador'}</p>
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
    {download}
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
  </>
);

export default RayenExtensionDownloadDetails;
