# Diario Editor Feature Matrix

| Capacidad                          | Diario             | HHR v1                 |
| ---------------------------------- | ------------------ | ---------------------- |
| Hoja clínica estructurada          | Sí                 | Sí                     |
| Título central + cabecera paciente | Sí                 | Sí                     |
| Secciones clínicas editables       | Sí                 | Sí                     |
| Médico + especialidad en pie       | Sí                 | Sí                     |
| Plantillas múltiples               | Sí                 | Parcial, base lista    |
| Epicrisis médica                   | Sí                 | Sí                     |
| Evolución médica                   | Sí                 | Preparado, no activado |
| Informe médico                     | Sí                 | Preparado, no activado |
| Epicrisis de traslado              | Sí                 | Preparado, no activado |
| Persistencia JSON                  | Sí                 | Sí                     |
| PDF estructurado                   | Sí                 | Sí                     |
| Host adapter / boundary            | Sí                 | Parcial                |
| Firma y bloqueo                    | Parcial/según host | Sí                     |
| Realtime Firestore                 | No aplica          | Sí                     |
| Lectura por enfermería             | Según host         | Sí                     |

## Paridad mínima exigida en HHR v1

1. Crear una epicrisis desde un paciente hospitalizado activo.
2. Precargar campos clínicos básicos del paciente.
3. Editar secciones clínicas en hoja tipo documento.
4. Guardar borrador y reabrirlo por episodio.
5. Validar y firmar, bloqueando edición posterior.
6. Generar PDF estructurado.
7. Permitir lectura e impresión a enfermería hospitalizados.

## Diferencias esperadas en v1

- No se generalizan todavía todas las plantillas visibles en UI.
- El host adapter no está extraído como paquete aislado; se implementa dentro de la feature.
