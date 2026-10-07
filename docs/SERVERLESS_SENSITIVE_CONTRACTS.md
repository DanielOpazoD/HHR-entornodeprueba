# Serverless Sensitive Contracts

## Netlify Functions críticas

| Endpoint                      | Método                 | Auth            | Roles                                                                                | Variables clave                                               | Errores esperables                |
| ----------------------------- | ---------------------- | --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `syslab-proxy`                | `GET`,`POST`,`OPTIONS` | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`, `viewer` | `VITE_FIREBASE_*`, `SYSLAB_PROXY_URL` o `VITE_SYSLAB_API_URL` | `400`, `401`, `403`, `502`, `503` |
| `mmrad-search`                | `GET`,`OPTIONS`        | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`, `viewer` | `VITE_FIREBASE_*`, `MMRAD_USERNAME`, `MMRAD_PASSWORD`         | `400`, `401`, `403`, `500`, `502` |
| `send-census-email`           | `POST`                 | Bearer Firebase | `admin`, `nurse_hospital`                                                            | `VITE_FIREBASE_*`, Gmail secrets                              | `400`, `401`, `403`, `500`        |
| `fhir-api`                    | `GET`, `OPTIONS`       | Bearer Firebase | roles clínicos permitidos                                                            | `VITE_FIREBASE_*`                                             | `401`, `403`, `404`, `500`        |
| `clinical-ai-summary`         | `POST`, `OPTIONS`      | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`           | `AI_PROVIDER`, provider keys, `VITE_FIREBASE_*`               | `400`, `401`, `403`, `404`, `500` |
| `clinical-document-ai-import` | `POST`, `OPTIONS`      | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`           | `AI_PROVIDER`, provider keys, `VITE_FIREBASE_*`               | `400`, `401`, `403`, `500`, `502` |
| `cie10-ai-search`             | `POST`, `OPTIONS`      | Bearer Firebase | roles clínicos generales                                                             | `AI_PROVIDER`, provider keys                                  | `400`, `401`, `403`, `500`        |
| `admin-ai-provider-status`    | `GET`, `OPTIONS`       | Bearer Firebase | `admin`                                                                              | `AI_PROVIDER`, provider keys                                  | `401`, `403`, `500`               |
| `admin-ai-provider-test`      | `POST`, `OPTIONS`      | Bearer Firebase | `admin`                                                                              | `AI_PROVIDER`, provider keys                                  | `400`, `401`, `403`, `502`        |
| `whatsapp-proxy`              | `POST`, `OPTIONS`      | según handler   | roles permitidos por handler                                                         | credenciales proxy externas                                   | `400`, `401`, `403`, `500`        |

## Reglas de contrato

- Toda Function sensible debe validar `Origin`.
- Toda Function sensible debe validar método HTTP.
- Toda Function sensible debe parsear JSON con helper compartido.
- Toda Function sensible debe responder con envelope consistente por runtime.
- Ninguna Function Netlify debe depender de `firebase-functions/v1`.
- Toda Function Netlify sensible que dependa del rol del usuario debe converger con el callable `checkUserRole`, no con una lectura paralela de `config/roles`.

## Firebase callable clínico

| Endpoint                            | Auth               | Roles                                                                      | Autoridad                                                                  |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `applyRayenClinicalEnrichmentBatch` | Firebase requerida | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor` | allowlist de campos, episodio y revisión verificados dentro de transacción |
| `setAdminCudyrResult`               | Firebase requerida | `admin`                                                                    | categoría cerrada, episodio y versión exacta verificados en transacción    |
| `openMedicalHandoffSpreadsheet`     | Firebase requerida | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor` | filas clínicas validadas y envío exclusivo a Apps Script institucional     |

Este callable recibe un lote acotado, no acepta rutas arbitrarias y registra únicamente
telemetría agregada sin identificadores de pacientes ni valores clínicos.

`setAdminCudyrResult` acepta únicamente las categorías CUDYR `A1` a `D3` o `null`
para eliminar el resultado. Exige administrador, coincidencia exacta del episodio clínico y
control optimista de versión; conserva las demás escalas y guarda historia y auditoría.

`openMedicalHandoffSpreadsheet` recibe como máximo 80 filas, no acepta RUT ni columnas
arbitrarias, valida claves estables y envía la carga únicamente a una URL institucional
de Apps Script configurada en el backend. El secreto compartido nunca se expone al navegador.

## Historial CUDYR

`archiveCudyrHistory` conserva observaciones oficiales por episodio/evaluación con
los roles existentes de escritura clínica y autoridad de sincronización verificada
en transacción. `readCudyrHistory` exige acceso clínico callable y pagina por período
o por un conjunto de hasta 30 episodios (100 recibos por página) para el contexto temporal.
Ambos fijan el establecimiento en el servidor y viven en `southamerica-east1`.
No alteran censos históricos ni habilitan acceso directo a la colección.
La operación `correct-discharge` exige `admin` o `nurse_hospital`, confirmación, motivo,
identidad exacta del episodio y revisión optimista. Persiste alta real y auditoría atómicamente,
sin modificar el egreso fuente ni el censo. Las lecturas `discharge-corrections` y
`discharge-audit` conservan el guard clínico. No se añaden endpoints ni permisos IAM.
Contrato, límites y validación: [CUDYR_HISTORY.md](./CUDYR_HISTORY.md).

## Convergencia obligatoria de rol

Para `syslab-proxy` y `mmrad-search`:

- la fuente de verdad sigue siendo `config/roles`;
- la resolución efectiva del rol debe pasar por el callable `checkUserRole`;
- no se debe reintroducir una vía separada de lectura de Firestore con semántica distinta;
- claims sincronizados no reemplazan esta convergencia.

Referencia:

- [docs/architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md](./architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)

## Complemento mensual CUDYR (documental)

`archiveCudyrHistory`, operación `import-monthly-supplement`, admite únicamente
`admin` o `nurse_hospital`, sesión y confirmación. Valida estructura normalizada,
período, establecimiento, límite de 500 pacientes/500 KB y archivo XLS/XLSX de
hasta 256 KiB. Conserva bytes, SHA-256, versión y recibo idempotente por usuario y
operación. No decodifica el binario en el servidor: la evidencia queda rotulada
`user_imported`, nunca aplicación clínica verificada. No acepta hospital del cliente.

`readCudyrHistory`, operación `monthly-supplements`, conserva el guard clínico,
filtra un mes y pagina hasta cinco versiones. No devuelve los bytes del original.
Las tres colecciones documentales quedan inaccesibles por las reglas cliente;
ninguna operación escribe censos, evaluaciones, altas ni categorías estadísticas.
No se añaden endpoints o permisos IAM. El importador no es autor del CUDYR fuente.
