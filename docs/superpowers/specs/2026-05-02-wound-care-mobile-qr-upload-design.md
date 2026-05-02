# Registro clínico audiovisual con carga móvil por QR

## Objetivo

Permitir que un profesional en turno abra el modal de registro clínico audiovisual de una hospitalización y genere un QR transitorio para subir fotos o videos directamente desde un celular. El QR debe actuar como credencial limitada, no como acceso general a la aplicación.

El nombre visible del módulo cambia de "Registro fotográfico de curaciones" a "Registro clínico audiovisual".

## Alcance MVP

- Agregar botón "Ver QR móvil" dentro del modal actual de wound care.
- Generar una sesión QR válida por 60 minutos.
- Permitir regenerar QR cuando venza o cuando el usuario lo solicite.
- Permitir revocar la sesión activa desde el modal.
- Abrir una ruta móvil interna optimizada para celular.
- La ruta móvil permite subir archivos audiovisuales nuevos al episodio actual.
- Todos los QR sucesivos apuntan al mismo evento clínico estable: `episodeKey` de la hospitalización.
- Reutilizar el pipeline existente de compresión, thumbnail, storage y metadata de `executeUploadWoundCarePhoto`.

## Fuera de alcance inicial

- No permitir edición de descripciones antiguas desde la ruta QR.
- No mostrar historial completo de fotos desde la ruta QR.
- No permitir borrado desde la ruta QR.
- No implementar permisos amplios por rol en el celular.
- No crear un segundo sistema de storage o metadata para audiovisuales.
- No implementar streaming de video ni edición multimedia avanzada.

## Modelo de seguridad

El QR contiene una URL con un identificador opaco de sesión, no datos clínicos directos.

Cada sesión registra:

- `sessionId`
- `hospitalId`
- `episodeKey`
- `patientRut`
- `patientName`
- `createdBy`
- `createdAt`
- `expiresAt`
- `revokedAt`
- `scope: "wound_care_upload_only"`

La sesión es válida si:

- existe,
- no está revocada,
- `expiresAt` es posterior a la hora actual,
- el `scope` corresponde a carga audiovisual,
- el episodio asociado coincide con la carga solicitada.

La ruta móvil no debe depender de login interactivo. El token del QR es la credencial limitada. Por eso la ventana de 60 minutos y la revocación son obligatorias.

## Flujo de usuario

1. Enfermería o médico abre el modal del paciente.
2. El modal muestra el título "Registro clínico audiovisual".
3. El usuario pulsa "Ver QR móvil".
4. La app crea o recupera una sesión vigente para esa hospitalización.
5. Se muestra el QR con:
   - nombre del paciente,
   - vigencia hasta hora local,
   - texto "Permite subir registros a esta hospitalización",
   - acciones "Regenerar" y "Revocar".
6. El profesional escanea el QR con el celular.
7. El celular abre una página móvil con:
   - identificación mínima del paciente,
   - botón para cámara/galería,
   - descripción opcional,
   - ubicación anatómica opcional,
   - estado de subida.
8. Al terminar la subida, la página confirma éxito y ofrece cargar otro archivo.
9. El modal principal refleja las nuevas fotos por la suscripción o recarga existente.

## Arquitectura propuesta

### Cliente administrativo

- `WoundCareModal` agrega el botón de QR y un panel/modal pequeño.
- Un hook `useWoundCareMobileUploadSession` maneja crear, regenerar, revocar y leer vigencia.
- El QR se genera en cliente con una librería liviana o componente SVG.

### Ruta móvil

- Nueva vista lazy: `/wound-care/mobile-upload/:sessionId`.
- Diseño mobile-first, sin navegación principal.
- Valida sesión al montar.
- Si expirada o revocada, muestra estado claro y no permite subir.
- Si vigente, reutiliza un formulario reducido basado en `PhotoUploadModal` y `PhotoUploadButton`.

### Dominio y persistencia

- Nuevo tipo `WoundCareMobileUploadSession`.
- Nuevo repository pequeño para sesiones QR.
- Nuevo use case:
  - `executeCreateWoundCareMobileUploadSession`
  - `executeRevokeWoundCareMobileUploadSession`
  - `executeValidateWoundCareMobileUploadSession`
  - `executeUploadWoundCarePhotoFromSession`

`executeUploadWoundCarePhotoFromSession` debe validar la sesión y luego llamar el flujo existente de upload con un actor sintético trazable, por ejemplo:

- `uid: "qr-session:<sessionId>"`
- `email: createdBy.email`
- `displayName: "Carga móvil autorizada por <nombre>"`
- `role: "qr_upload"`

La metadata de la foto debe conservar `uploadedBy` y agregar `uploadedViaSessionId` como campo opcional validado por schema para trazabilidad de carga móvil.

## Auditoría

Se auditan al menos:

- generación de QR,
- revocación,
- intento de uso expirado o revocado,
- subida exitosa vía QR,
- error de subida vía QR.

Los eventos deben incluir:

- `episodeKey`,
- `patientRut` enmascarado donde corresponda,
- `createdBy`,
- `sessionId`,
- `ipAddress`,
- `userAgent` solo si aporta trazabilidad técnica para el acceso móvil.

## UX operacional

El botón debe estar visible solo en la hospitalización actual y cuando el modal no está en modo lectura.

Textos sugeridos:

- Título del módulo: "Registro clínico audiovisual"
- Botón: "Ver QR móvil"
- Estado vigente: "QR válido hasta HH:MM"
- Estado vencido: "QR vencido. Genera uno nuevo desde el computador."
- Estado revocado: "Acceso revocado."
- Aviso de alcance: "Este acceso solo permite subir registros a esta hospitalización."

La página móvil debe priorizar:

- carga rápida,
- botones grandes,
- feedback claro,
- no mostrar menús de la app,
- recuperación ante pérdida de red.

## Testing y verificación

Tests unitarios:

- cálculo de expiración a 60 minutos,
- validación de sesión vigente/expirada/revocada,
- no permitir upload con sesión inválida,
- todos los QR sucesivos conservan el mismo `episodeKey`,
- actor de subida vía QR queda trazable.

Tests de componente:

- `WoundCareModal` muestra "Registro clínico audiovisual".
- botón "Ver QR móvil" aparece solo para episodio actual editable.
- panel muestra vigencia, regenerar y revocar.
- vista móvil muestra estados vigente, vencido y revocado.

Checks:

- `npm run typecheck`
- `npm run lint`
- suite focal wound-care
- `npm run check:quality`

## Criterio de éxito

El usuario puede generar un QR desde el modal, abrirlo en celular, subir una foto al mismo episodio clínico y verla reflejada en el registro audiovisual, con sesión expirable/revocable y sin exponer el resto de la aplicación.
