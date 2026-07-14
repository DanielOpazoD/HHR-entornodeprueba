# Extensión · Puente de censo Rayen → HHR

Extensión de Chrome (Manifest V3) que lee el censo de hospitalizados de **Rayen / Ficha
Médico** y lo entrega al **censo local HHR** para importarlo con revisión. Es la Fase 2 del
proyecto (ver `../PLAN-SINCRONIZACION.md`).

## Cómo funciona

```
HHR (localhost / testinghhr)                 Rayen (fichamedico)
  botón "Importar desde Rayen"                 inject (MAIN world)
        │ postMessage                            · envuelve fetch → captura token HSP
        ▼                                        · lee censo + egresos + demografía
  content-hhr.js  ── chrome.runtime ──►  background.js  ── chrome.tabs ──►  content-fichamedico.js
        ▲                                                                      │ postMessage
        └───────────── snapshot ◄──────── background ◄──── snapshot ◄──────────┘  inject normaliza
        │ postMessage (HHR_RAYEN_CENSUS_SNAPSHOT)
        ▼
  bridge del módulo rayen-import  → preview / auto → aplica al DailyRecord
```

- El **token HSP nunca sale** del mundo principal de Rayen; solo viaja el snapshot ya normalizado.
- La lectura usa `filterType=3` (sin médico + Servicio Todos = censo completo) + `filterType=2`
  (egresos), y `patientHeaderData/{encId}` por paciente. Marca `isComplete=true`.

## Archivos

| Archivo | Rol |
| --- | --- |
| `manifest.json` | MV3: permisos de host, content scripts (MAIN + ISOLATED), service worker |
| `inject-fichamedico.js` | MAIN world en Rayen: captura token, lee y **normaliza** al snapshot |
| `content-fichamedico.js` | ISOLATED en Rayen: relé background ⇄ mundo principal |
| `background.js` | Enruta la petición del HHR a la pestaña de Rayen y devuelve el snapshot |
| `content-hhr.js` | ISOLATED en el HHR: relé página (puente) ⇄ background |
| `encounter-navigation.js` | Valida el episodio y construye la ruta segura para abrirlo en Ficha Médico |

## Instalar (modo desarrollador)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → selecciona esta carpeta `extension/`.
4. **Recarga la pestaña de Rayen** (`fichamedico.rayensalud.cl`) si ya estaba abierta — es
   necesario para que el capturador de token quede activo desde el inicio.

## Usar

1. Ten **abierta y con sesión iniciada** la pestaña de Rayen Ficha Médico (la lista de pacientes).
2. En el HHR (`localhost:3000` o `testinghhr.netlify.app`), abre el censo y pulsa
   **"Importar desde Rayen"**.
3. Según el modo (Configuración → Integraciones): se abre el **preview** para confirmar, o —en
   modo automático experimental— se aplica solo (salvo conflictos/egresos inferidos, que caen a preview).
4. En una fila sincronizada, el icono de enlace externo abre el episodio exacto en Ficha Médico.
   Reutiliza una pestaña existente cuando está disponible; esta acción es solo navegación y no escribe
   datos en Rayen.

## Requisitos y notas

- Chrome 111+ (usa `world: "MAIN"` en content scripts).
- Debe existir **una pestaña de Rayen abierta y logueada**; si no, el HHR muestra el error
  "No hay una pestaña de Rayen abierta".
- El token se captura de las llamadas que hace la propia app de Rayen. Si acabas de instalar la
  extensión, **recarga Rayen** para que el capturador esté activo antes de la primera lectura.
- La escritura al censo la hace el HHR con **tu sesión de Firebase** (rol `nurse_hospital`/`admin`);
  la extensión no toca Firestore ni almacena credenciales.

## Verificación

- El núcleo de lectura+normalización se probó contra datos reales de Rayen (4 pacientes) y produjo
  un `RayenCensusSnapshot` correcto (apellidos separados, RUN, cama, diagnóstico, `isComplete`).
- La sintaxis de los 5 archivos pasa `node --check`.
- **Pendiente de prueba en vivo (requiere cargar la extensión en Chrome):** el ruteo completo
  background ⇄ tabs ⇄ mundos. Son patrones MV3 estándar, pero no se ejecutaron de punta a punta.

## Pendiente / a confirmar con datos reales

- Cómo aparece un paciente **CMA** en el encounter API (servicio/cama) — el `bedMapping` lo maneja por
  prefijo `CMA`, pero conviene verlo con un caso real.
- La representación de un **egresado** (alta / CMA / traslado) — la pestaña de egresos estaba vacía.
