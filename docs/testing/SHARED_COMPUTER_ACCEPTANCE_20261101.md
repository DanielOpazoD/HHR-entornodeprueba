# Aceptación del equipo compartido — 1 noviembre 2026

Base: `origin/main` en `4bffb35f0` (incluye una hora de inactividad, nombre activo y
retención de la entrega de enfermería). Rama independiente de la corrección de
permisos de extensión; este recorrido no cambia código de aplicación.

## Ejecutar

Con Node 22, dependencias de `npm ci`, Java 21 y Chromium de Playwright instalado:

```bash
bash scripts/run-shared-computer-acceptance.sh
```

El lanzador usa `scripts/lib/firebase-emulator-ci.sh`, selecciona puertos libres y
levanta Auth y Firestore para `demo-hhr-nursing-accounts`. Genera las reglas desde
sus fuentes y cierra los emuladores al terminar. El navegador usa el servidor Vite
real en `127.0.0.1:4184`, sin modo E2E ni identidad inyectada en Web Storage.
No reutiliza un navegador del responsable ni sus credenciales. Cada caso reinicia
**solo el proyecto demo de los emuladores creados por el comando**.

Los callables se interceptan únicamente para ese proyecto demo, se verifican los
tokens con Auth Emulator y se ejecutan sus handlers reales contra Firestore
Emulator. Las demás peticiones externas se bloquean. Esto verifica SDK, cuenta,
reglas de lectura/escritura del navegador, transacciones y UI; no acredita un
servidor Functions HTTP, CORS desplegado, App Check ni un despliegue de producción.
El correo del administrador protegido se usa únicamente en una afirmación Google
sintética aceptada por el emulador. No se autentica con Google real.

## Recorridos y límites

- A empieza pendiente con la clave inicial, ve la exigencia de fijar su clave,
  completa el ingreso y aparece por nombre en la barra. Edita Novedades y Pendientes
  desde la entrega de enfermería y se comprueba el texto confirmado en Firestore.
- Se prepara una entrega A en conflicto, no enviada en IndexedDB real, con propietario, versión
  y rutas explícitas. Un día exclusivamente local permite distinguir un residuo de
  A de los censos hospitalarios compartidos que B sí tiene permiso para consultar.
  La creación de ese pendiente es una semilla controlada, no una simulación de un
  fallo físico de disco ni de toda la cadena de edición sin conexión. El conflicto impide confirmar el envío,
  sin desconectar los módulos del servidor Vite.
- A cierra con la entrega pendiente, descarga la copia mediante el diálogo existente y entra B
  en la misma pestaña y perfil. B ve su nombre y un aviso de la entrega ajena que
  contiene la identidad de A, sin el texto clínico. No recibe el día local ni la
  tarea de A por el lector de operaciones; la fila durable mantiene dueño y texto.
- A vuelve con su clave privada: recupera la visibilidad de su tarea y el texto
  conservado. El día sembrado no existe remotamente: no se exige ni se acredita
  que esa edición conflictiva llegue al servidor; se comprueba su conservación.
- B permanece autorizado a los 59 minutos sin actividad y vuelve al acceso tras
  una hora y la gracia de un segundo, usando `page.clock`, sin esperar una hora
  real. Se comprueban el cierre visible y la retirada del propietario local.
- B, autenticado mediante Auth Emulator con rol efectivo `nurse_hospital`, llama al
  cliente real de enriquecimiento para el CUDYR de D−1. Se comprueba categoría C2
  persistida y repetición idempotente. La captura Eloísa y la corrida confirmada
  son fixtures sintéticos; no se ejecuta una sincronización con Eloísa real.

Reglas preservadas: SAVE-01 (copia local no equivale a guardado remoto), SAVE-03
(cola y respaldo conservados), ID-01/02 (episodio explícito), TIME-02 (fecha de
hospital desde las utilidades existentes). No se amplía la ventana de 48 horas,
la autoridad de otros roles ni los campos que puede modificar enfermería.

La evidencia JSON queda en `reports/e2e/shared-computer/report.json`; Playwright
conserva captura y traza de los casos fallidos en `test-results/`.

## Resultado

Chromium local, Node 22.22.2: **3 casos aprobados**, sin fallos esperados ni omisiones,
en **1,1 minutos** en la ejecución aislada final. Además: **61 casos unitarios aprobados**
en cinco suites existentes (actividad, vencimiento individual, retención/recuperación y
UI del relevo). La suite de autoridad de Firestore requiere su lanzador propio y no
se ejecuta como prueba unitaria: sus 11 casos quedaron omitidos en esa invocación;
el CUDYR de D−1 sí se ejecutó con Auth/Firestore reales emulados desde Chromium.

No se encontró un defecto de producto en los límites acreditados. Durante la preparación
se corrigió el selector del nombre (está al lado del botón de usuario) y un fallo del
arnés: desconectar también Vite impedía cargar por primera vez los módulos de cierre.
Ese fallo en desarrollo no acredita una regresión del build PWA publicado; el recorrido
final usa un conflicto durable para comprobar la salida con copia, manteniendo disponibles
los módulos. La comprobación del propietario espera la finalización de la limpieza local:
la pantalla de acceso puede aparecer antes de retirarse esa marca, y la admisión siguiente
espera la misma transición. No se probó el cierre con módulos fríos en un build de producción sin red.

Se entrega como **comando documentado, fuera de CI automático**. Se intentó añadirlo
al final de `test:accounts:emulator:ci`, pero el carril existente falló **antes** de llegar
a Playwright: `src/tests/emulator/nursing-accounts.emulator.test.ts:99`, `beforeAll`
agotó sus 30 segundos; sus dos casos quedaron omitidos. No es evidencia de un defecto
clínico ni un fallo del recorrido nuevo. Se retiró la conexión provisional a ese carril,
sin modificar sus tiempos ni sus pruebas. El inventario E2E identifica expresamente
este recorrido como `manual`, con el comando automatizado anterior.

No se incorpora una nueva etapa inestable ni se amplían límites del carril existente.
La ejecución aislada acredita los tres casos en macOS; la estabilidad en Linux y CI
queda sin probar. Una ejecución local no es CI aprobada.
