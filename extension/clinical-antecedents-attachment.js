/** Builds HCC attachment URLs without exposing their temporary SAS tokens to HHR. */
(function (root) {
  'use strict';
  const create = ({ list, text, openTab }) => {
    const idFor = record =>
      btoa(encodeURIComponent(`${record.file.Cgd_Id || ''}\0${record.file.PathAzure}`))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const records = detail =>
      list(detail.Documentos).flatMap(container =>
        list(container?.Documento)
          .filter(file => text(container?.Uri) && text(container?.Sas) && text(file?.PathAzure))
          .map(file => ({ container, file }))
      );
    const summaries = detail =>
      records(detail).map((record, index) => ({
        id: idFor(record),
        label: text(record.file.NombreArchivo) || `Adjunto ${index + 1}`,
      }));
    const open = async (detail, attachmentId) => {
      if (!/^[A-Za-z0-9_-]+$/.test(attachmentId || ''))
        throw new Error('El adjunto ya no está disponible.');
      const record = records(detail).find(candidate => idFor(candidate) === attachmentId);
      if (!record) throw new Error('El adjunto ya no está disponible.');
      const url = new URL(text(record.container.Uri));
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'gestordocumentalrayen.blob.core.windows.net'
      )
        throw new Error('El adjunto tiene un destino no autorizado.');
      const segments = text(record.file.PathAzure).split('/');
      if (segments.some(segment => !segment || segment === '.' || segment === '..'))
        throw new Error('El adjunto tiene una ruta no autorizada.');
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${segments
        .map(segment => encodeURIComponent(segment))
        .join('/')}`;
      const signature = new URLSearchParams(text(record.container.Sas).replace(/^\?/, ''));
      if (!['sig', 'se', 'sp', 'sr'].every(key => signature.has(key)))
        throw new Error('El enlace del adjunto venció.');
      signature.forEach((value, key) => url.searchParams.set(key, value));
      await openTab({ url: url.href });
    };
    return { summaries, open };
  };
  root.HhrClinicalAntecedentsAttachment = { create };
})(typeof self !== 'undefined' ? self : globalThis);
