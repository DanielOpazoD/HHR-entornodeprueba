# `src/features/wound-care`

## Proposito

Modulo de documentacion fotografica clinica de curaciones de heridas durante la hospitalizacion.
Permite al equipo de enfermeria registrar fotograficamente la evolucion de las curaciones,
con soporte para consentimiento informado del paciente.

## Integracion

El modulo se integra como un **icono de camara sutil** en la celda del paciente (`HandoffPatientCell`)
de la tabla de Entrega de Turno de Enfermeria. Al hacer clic, se abre un modal con el historial
fotografico completo del paciente (hospitalizacion actual y previas).

## Subcapas internas

| Path           | Rol                                                                              |
| -------------- | -------------------------------------------------------------------------------- |
| `components/`  | UI: modal, galeria, lightbox, upload, consent                                    |
| `controllers/` | Logica pura: estado de consentimiento, validacion de upload, agrupacion de fotos |
| `domain/`      | Contratos, validacion de archivos, opciones de ubicacion corporal                |
| `hooks/`       | Suscripcion a datos, orquestacion de uploads, historial multi-episodio           |
| `services/`    | Generacion de PDF de consentimiento informado                                    |

## API publica

```typescript
// Desde HandoffPatientCell.tsx:
import { WoundCareModal } from '@/features/wound-care/components/WoundCareModal';
```

Codigo externo solo debe importar desde `@/features/wound-care` o componentes especificos.

## Flujos criticos

### Subida de fotografia

```
PhotoUploadButton -> PhotoUploadModal -> useWoundCareUpload.uploadPhoto()
  -> executeUploadWoundCarePhoto (use case)
    -> compressImage + generateThumbnail (parallel)
    -> storagePort.uploadPhoto + uploadThumbnail (parallel)
    -> photoPort.create (Firestore metadata)
```

### Subida de consentimiento

```
ConsentUploadModal -> useWoundCareUpload.uploadConsent()
  -> executeUploadWoundCareConsent (use case)
    -> storagePort.uploadConsent (Firebase Storage)
    -> consentPort.create (Firestore metadata)
```

### Impresion de formulario de consentimiento

```
WoundCareModal -> generateConsentPdf()
  -> jsPDF dynamic import
  -> PDF generation with hospital logo
  -> window.open (new tab with print dialog)
```

### Visualizacion de historial

```
WoundCareModal -> useWoundCareHistory(patientRut)
  -> photoPort.listByPatientRut + consentPort.listByPatientRut
  -> Groups by episodeKey (current first, then by date)
  -> EpisodeSection (collapsible) -> PhotoGallery -> PhotoLightbox
```

## Colecciones Firestore

| Coleccion           | Path                                           | Descripcion                                  |
| ------------------- | ---------------------------------------------- | -------------------------------------------- |
| `woundCareConsents` | `hospitals/{id}/woundCareConsents/{consentId}` | Consentimientos informados                   |
| `woundCarePhotos`   | `hospitals/{id}/woundCarePhotos/{photoId}`     | Metadata de fotos (URLs, dimensiones, audit) |

## Firebase Storage

```
wound-care/
  consents/{hospitalId}/{patientRut}/{episodeKey}/{consentId}.{ext}
  photos/{hospitalId}/{patientRut}/{episodeKey}/{date}/{photoId}.webp
  thumbnails/{hospitalId}/{patientRut}/{episodeKey}/{date}/{photoId}_thumb.webp
```

## Invariantes

1. **Consentimiento es opcional** -- las fotos se pueden subir sin consentimiento firmado
2. **Soft-delete** -- las fotos nunca se eliminan fisicamente; se marcan con `isDeleted`
3. **Compresion client-side** -- las fotos se comprimen a WebP antes de subir (critico para la conectividad de Rapa Nui)
4. **Thumbnails client-side** -- generados en el navegador, no via Cloud Functions
5. **Fotos se agrupan por `takenAt`** -- la fecha de la curacion, no de la subida
6. **Historial multi-episodio** -- el modal muestra fotos de hospitalizaciones actuales y previas

## Tests

```bash
npx vitest run src/tests/application/wound-care/
npx vitest run src/tests/features/wound-care/
npx vitest run src/tests/schemas/woundCareSchemas.test.ts
```
