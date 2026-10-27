# Reglas para agentes

Este archivo lo leen Codex y otros agentes. Claude Code lo carga desde [CLAUDE.md](CLAUDE.md).
Vale para cualquier persona o agente que cambie este repositorio.

HHR es la aplicación clínica del Hospital Hanga Roa, en Rapa Nui. Producción trabaja con datos
reales de pacientes.

## Antes de cambiar algo

1. Leer el [contrato operativo](docs/DOMAIN_RULES.md). Sus reglas tienen identificadores
   estables, como ID-01, TIME-02 o SAVE-01, y mandan sobre el código y sobre este archivo.
2. Leer [CONTRIBUTING.md](CONTRIBUTING.md). Si el área tiene un diseño propio en `docs/`,
   leerlo también. Por ejemplo, la fase 1a está en
   [DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md](docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md).
3. Un merge a `main` llega a producción. Netlify publica solo y CI despliega Functions.

## Reglas y qué las hace cumplir

Cada fila dice qué impone la regla. **[docs]** marca las que solo dependen de que el agente
lea este archivo.

### Datos clínicos

| Regla                                                                                                                                                                                                     | Qué la impone                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| La identidad es paciente más episodio. La cama es una ubicación. Madre y recién nacido son personas distintas (ID-01 a ID-03).                                                                            | Pruebas de identidad y de RN                    |
| Un pasaporte nunca se convierte en RUT ni se compara como RUT. No copiar `/[^0-9kK]/` fuera de `src/utils/rutUtils.ts`.                                                                                   | Pruebas puntuales; **[docs]** para código nuevo |
| «Hoy», la hora y el turno salen del reloj del hospital, Pacific/Easter (`src/utils/clinicalTimeZone.ts`). No cortar un instante ISO para obtener una fecha, tampoco en Functions ni en Netlify (TIME-02). | `npm run check:clinical-clock`                  |
| Un paciente que falta en una fuente parcial o fallida no está dado de alta ni borrado (CEN-01).                                                                                                           | Pruebas de egreso y de sincronización           |
| No tocar CUDYR saneado, decisiones manuales, censos verificados ni horas oficiales de egreso de Eloísa (TIME-03, CUD-01).                                                                                 | **[docs]**                                      |

### Guardado y sincronización

| Regla                                                                                                                                                          | Qué la impone                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ninguna reparación, cierre de sesión o reinicio borra la cola de sincronización, los parches pendientes ni el outbox sin una confirmación explícita (SAVE-03). | Pruebas de arranque y de cola; **[docs]** para rutas nuevas                          |
| Nunca purgar una cola por antigüedad ni por número de fallos.                                                                                                  | **[docs]**                                                                           |
| Una lectura fallida no es «sin datos». Una escritura fallida no es «guardado» (SAVE-01).                                                                       | `npm run check:empty-on-failure-reads` en la capa de datos; **[docs]** fuera de ella |
| Los documentos `clinicalDerived` de la fase 1a los escribe solo el servidor. No cambiar `HHR_CLINICAL_DERIVED_SPLIT_FROM` sin el responsable.                  | `firestore.rules`; **[docs]**                                                        |

### Pruebas y datos reales

| Regla                                                                                                                                                                        | Qué la impone                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Las pruebas usan solo datos sintéticos. Nunca sincronizar con el Firebase de producción ni leer sus datos. El emulador se levanta con `scripts/lib/firebase-emulator-ci.sh`. | El lanzador del emulador; **[docs]**              |
| La telemetría puede llevar datos del paciente para diagnosticar, pero nunca excepciones crudas ni credenciales.                                                              | `npm run check:secret-leaks` en parte; **[docs]** |
| Cada prueba verifica lo que observa quien usa el código. Al borrar código o pruebas, ningún comportamiento vigente pierde su última prueba.                                  | **[docs]**                                        |

### Código y dependencias

| Regla                                                                                                                       | Qué la impone                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Todo paquete importado está declarado en `package.json`.                                                                    | `npm run check:declared-dependencies`                                  |
| No hay ciclos de imports en tiempo de ejecución.                                                                            | `npm run check:import-cycles`                                          |
| Los módulos son cohesivos y tienen como máximo 600 líneas.                                                                  | `npm run check:module-size`                                            |
| Las dependencias de la raíz y de Functions pasan la auditoría sin hallazgos altos ni críticos, y sin excepciones aceptadas. | `scripts/check-dependency-vulnerabilities.mjs` en `security-audit.yml` |
| Sin reescrituras, plataformas ni colas nuevas. Un cambio de rendimiento necesita una etapa y una causa medidas.             | **[docs]**                                                             |
| No borrar `Formularios/` ni `Hospital Salvador/`. Preguntar antes de tocar `printables/` o los PNG de la raíz.              | **[docs]**                                                             |

### Producción y pull requests

| Regla                                                                                                                                                        | Qué la impone                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Publicar, desplegar Functions o reglas, o cambiar la configuración de Netlify, solo si el responsable lo pide. Un merge a `main` ya publica.                 | **[docs]**                                |
| `ci-summary` es el único check requerido, y `main` exige ramas al día. No saltarlo ni relajarlo.                                                             | Ruleset de `main`                         |
| CI del SHA final acredita sus controles: no duplicar la matriz local. Verificar alcance y fallos conocidos; ver `docs/SAFE_CHANGE_CHECKLIST.md`.             | `ci-summary`; **[docs]** para no duplicar |
| Un agente mergea solo sus propias PRs, en verde y de a una. Las PRs de otros hilos no se tocan.                                                              | Ruleset en parte; **[docs]**              |
| Antes de decir «listo», comprobar que la PR se puede mergear con `main` (`gh pr view --json mergeStateStatus`) y decir con qué evidencia se probó el cambio. | **[docs]**                                |
| Una PR resuelve una sola cosa. No corregir de paso lo que no se pidió.                                                                                       | **[docs]**                                |
| Los commits se escriben en inglés (Conventional Commits). Los títulos y descripciones de PR, en español.                                                     | **[docs]**                                |
| Nunca usar `git stash` sin una etiqueta propia, porque el stash se comparte entre worktrees y sesiones.                                                      | **[docs]**                                |

### Trabajo con el responsable

| Regla                                                                                                                                                       | Qué la impone |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Avanzar sin pedir permiso en el trabajo reversible. Preguntar solo ante lo irreversible o lo que decide el responsable.                                     | **[docs]**    |
| Informar en español claro, sin jerga.                                                                                                                       | **[docs]**    |
| Estas decisiones no se reabren: la ventana de 48 horas de `canWritePreviousDay` se mantiene, y el endpoint de resumen clínico con IA se retiró a propósito. | **[docs]**    |

## Mantener esta tabla

- Cuando el responsable corrige a un agente, arreglar el error y agregar aquí la regla.
- Si la regla ya estaba y nada la hacía cumplir, el error es una repetición. En el mismo
  cambio, imponerla al nivel más alto que funcione y actualizar su fila. El orden es:
  arquitectura, tipos, un control cuyo error nombre el arreglo, una prueba.
- Quitar una regla cuando su error ya no puede ocurrir.
