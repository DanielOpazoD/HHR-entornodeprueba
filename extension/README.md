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
  (egresos), `patientHeaderData/{encId}` y el diagnóstico principal activo por paciente. Marca
  `isComplete=true` y entrega el código CIE-10 cuando Ficha Médico lo informa.
- El panel clínico se consulta solo al abrirlo: combina historial, estado vigente de fármacos y
  plan de cuidados. Así distingue suspendidos, muestra acciones de enfermería ejecutadas y separa
  entregas de turno médicas y de enfermería sin persistir ese contenido en HHR.

## Archivos

| Archivo | Rol |
| --- | --- |
| `manifest.json` | MV3: permisos de host, content scripts (MAIN + ISOLATED), service worker |
| `inject-fichamedico.js` | MAIN world en Rayen: captura token, lee y **normaliza** al snapshot |
| `fichamedico-normalization.js` | Selecciona el diagnóstico principal activo y su CIE-10 sin depender de la UI de Rayen |
| `content-fichamedico.js` | ISOLATED en Rayen: relé background ⇄ mundo principal |
| `background.js` | Enruta la petición del HHR a la pestaña de Rayen y devuelve el snapshot |
| `content-hhr.js` | ISOLATED en el HHR: relé página (puente) ⇄ background |
| `encounter-navigation.js` | Valida el episodio y construye la ruta segura para abrirlo en Ficha Médico |
| `health-check.js` | Comprueba relés activos en Ficha Médico/Gestión de Camas sin leer tokens ni datos clínicos |
| `clinical-panel-fetch.js` | Pagina estados farmacológicos y evita presentar fallas parciales como datos vacíos |

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
5. La barra Eloísa muestra la versión del puente y la disponibilidad independiente de Ficha Médico y
   Gestión de Camas. El diagnóstico se ejecuta al abrir/recuperar foco y antes de sincronizar.
6. El botón de panel clínico de cada paciente sincronizado abre una vista en vivo con mundos
   Médico/Enfermería, entregas de turno, indicaciones y cuidados de enfermería.

## Requisitos y notas

- Chrome 111+ (usa `world: "MAIN"` en content scripts).
- Debe existir **una pestaña de Rayen abierta y logueada**; si no, el HHR muestra el error
  "No hay una pestaña de Rayen abierta".
- El token se captura de las llamadas que hace la propia app de Rayen. Si acabas de instalar la
  extensión, **recarga Rayen** para que el capturador esté activo antes de la primera lectura.
- La escritura al censo la hace el HHR con **tu sesión de Firebase** (rol `nurse_hospital`/`admin`);
  la extensión no toca Firestore ni almacena credenciales.

## Verificación

- El núcleo de lectura+normalización se probó contra datos reales de Rayen y produce un
  `RayenCensusSnapshot` con apellidos separados, RUN, cama, diagnóstico principal, CIE-10 e
  `isComplete`.
- La sintaxis de los scripts operativos pasa `node --check`.
- El protocolo v3 minimiza el historial, los estados de medicación y el plan de cuidados antes de
  cruzar hacia HHR; el contenido del panel sigue siendo efímero y de solo lectura.

## Pendiente / a confirmar con datos reales

- Cómo aparece un paciente **CMA** en el encounter API (servicio/cama) — el `bedMapping` lo maneja por
  prefijo `CMA`, pero conviene verlo con un caso real.
- La representación de un **egresado** (alta / CMA / traslado) — la pestaña de egresos estaba vacía.
