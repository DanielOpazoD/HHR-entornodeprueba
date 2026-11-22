/**
 * PDF coordinate mapping for "Solicitud de Imágenes" form fields.
 * Y coordinates are from the BOTTOM of the page (PDF standard).
 * Extracted via PDF field mapping tool.
 */
export const SOLICITUD_FIELD_COORDS = {
  // Full name: one line from «Nombre Completo:» to the «Ficha» divider (x ≈ 462).
  nombreCompleto: { x: 117.57, y: 766.71, maxWidth: 334 },

  // RUT
  rut: { x: 60.47, y: 750.58, maxWidth: 135.01 },

  // Age
  edad: { x: 229.74, y: 750.58, maxWidth: 52.39 },

  // Birth date
  fechaNacimiento: { x: 472.95, y: 750.58, maxWidth: 88.68 },

  // Diagnosis
  diagnostico: { x: 131.64, y: 733.82, maxWidth: 206.24 },

  // Today's date (request date)
  fechaSolicitud: { x: 139.04, y: 786.2, maxWidth: 59.79 },

  // Requesting Physician
  medicoTratante: { x: 315.0, y: 108.0, maxWidth: 145.33 },
};

/**
 * PDF coordinate mapping for "Encuesta Medio Contraste" form fields.
 */
export const ENCUESTA_FIELD_COORDS = {
  // Full name: the «Nombre:» line ends before «Edad:» (x ≈ 330).
  nombreCompleto: { x: 99.57, y: 646.73, maxWidth: 226 },
  edad: { x: 359.08, y: 646.73, maxWidth: 52.39 },
  rut: { x: 423.13, y: 646.73, maxWidth: 135.01 },
  fechaNacimiento: { x: 164.95, y: 586.44, maxWidth: 88.68 },
  diagnostico: { x: 112.31, y: 486.26, maxWidth: 206.24 },
  medicoTratante: { x: 409.0, y: 615.4, maxWidth: 150.02 },
};

/**
 * PDF coordinate mapping for "Consentimiento Informado General".
 */
export const CONSENTIMIENTO_FIELD_COORDS = {
  // Full name: the «Nombre Paciente:» line ends at the right margin (x ≈ 522).
  nombreCompleto: { x: 188.4, y: 649.0, maxWidth: 326 },
  rut: { x: 130.87, y: 624.51, maxWidth: 131.31 },
  edad: { x: 314.21, y: 624.51, maxWidth: 50.95 },
  diagnostico: { x: 142.75, y: 595.5, maxWidth: 200.6 },
  fecha: { x: 415.53, y: 690.05, maxWidth: 58.16 }, // getTodayISO in JSON
  medicoTratante: { x: 145.52, y: 155.19, maxWidth: 152.03 }, // NombreyapellidoMed in JSON
};
