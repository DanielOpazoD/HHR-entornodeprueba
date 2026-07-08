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

## Convergencia obligatoria de rol

Para `syslab-proxy` y `mmrad-search`:

- la fuente de verdad sigue siendo `config/roles`;
- la resolución efectiva del rol debe pasar por el callable `checkUserRole`;
- no se debe reintroducir una vía separada de lectura de Firestore con semántica distinta;
- claims sincronizados no reemplazan esta convergencia.

Referencia:

- [docs/architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md](./architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)
