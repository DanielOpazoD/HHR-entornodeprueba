# Experimento manual de aislamiento E2E

Owner: tooling y pruebas HHR. Riesgo medio por ejecución y agregación experimental.
Rollback: retirar este workflow manual y sus scripts. El CI obligatorio conserva su configuración.

El experimento compara el lanzador crítico actual, variante A, con dos VM independientes,
variante B. La segunda VM tiene checkout, build, servidor, emulador y reportes propios.
Cada spec conserva todos sus casos y el config mantiene un worker, secuencias y retries.
Todavía no hay una mejora de velocidad demostrada.

El workflow `e2e-isolation-experiment.yml` sólo admite `workflow_dispatch`.
Debe estar registrado en main antes de ejecutarlo. No despliega ni usa datos clínicos reales.
Sus permisos sólo leen código y Actions. El proyecto del emulador y los endpoints
de loopback siguen gobernados por el entorno crítico existente.

## Protocolo de ejecución

Después de integrar el registro, crear una referencia congelada a ese commit y publicarla.
Los diez dispatches usan esa misma referencia y el SHA completo. Ejecutar, en orden,
A1, B1, A2, B2, A3, B3, A4, B4, A5, B5. Esperar el resultado de cada dispatch
antes de iniciar el siguiente. La concurrencia global evita ejecuciones simultáneas,
pero GitHub puede reemplazar runs pendientes si se envían muchos a la vez.

Ejemplo de un dispatch sobre una referencia que ya está publicada:

```sh
task_ref=codex/e2e-isolation-frozen
task_sha=$(git rev-parse "$task_ref")
gh workflow run e2e-isolation-experiment.yml \
  --repo DanielOpazoD/HHR-entornodeprueba --ref "$task_ref" \
  -f variant=A -f pair=1 -f expected_sha="$task_sha"
```

Anotar cada run ID, variante, pareja, SHA y attempt. Conservar todos los errores,
cancelaciones y reintentos. Un rerun no sustituye una muestra fallida.
No cambiar timeouts, datos, workers, dependencias ni selección entre muestras.

## Evidencia y conservación del comportamiento

Cada lane colecciona el pack crítico completo y los 61 IDs de preview, sin ejecutar
preview en este experimento. El CI normal sigue ejecutando sus cuatro lanes preview.
La colección crítica debe conservar 46 IDs canónicos. Los hashes fijan ambos conjuntos.
La unión ejecutada debe incluir cada ID crítico una vez, con un único resultado passed.
Omisiones, extras, skips, retries, errores globales y artefactos ausentes rechazan el run.

Full y lane-1 ejecutan runtime, upgrade y offscreen de extensión, flow con su budget
y census remote performance. Lane-2 sólo ejecuta su selección crítica.
A conserva el lanzador existente. En B, cada VM construye antes de sus pruebas.
Un fallo detiene las fases dependientes; las ausencias quedan registradas como fallo.

El agregador valida SHA limpio, fuentes invariables, run, attempt exacto, productor real,
argumentos y versiones. Publica referencias y hashes de los sobres originales.
Su resumen derivado no acredita que el agregador haya ejecutado pruebas.
Los uploads conservan la evidencia disponible aunque una fase falle.

## Medición y decisión

Descargar `e2e-isolation-summary-<attempt>`, los sobres originales y los diagnósticos de cada run.
Los nombres incluyen el intento para conservar artefactos anteriores. Un rerun parcial
sin todas las lanes del intento actual se rechaza; no reutiliza evidencia anterior.
Obtener además jobs, steps y logs finales mediante la API de Actions para conservar
cola, preparación, caches y duración de todos los runners, incluido el agregador.
Las acciones compartidas fijan majors de Node y Java y versiones exactas mediante
lockfile y metadatos del emulador. Registrar sus versiones efectivas y la imagen del runner.
Si cambian entre muestras, declarar la comparación no comparable.

En A, el intervalo `critical-ci` incluye build, critical y flow.
En B, `emulator` contiene sus fases internas. No sumar intervalos anidados.
El tiempo de casos de Playwright tampoco equivale a la duración del job.

Presentar mediana y rango de cinco muestras por variante, errores, intentos, skips
y suma de runner-segundos. Separar tiempo hasta el resumen y ocupación total.
Perfilar una corrida aparte para identificar el límite, sin mezclarla con las muestras.
Una diferencia dentro de la dispersión es inconclusa. Más coste sin menor espera
o cualquier pérdida de estabilidad conserva A.

Sólo un PR posterior, sustentado en esas mediciones, puede modificar el CI obligatorio.
Una mejora del carril crítico no acredita reducir la espera global del pipeline;
para esa afirmación hacen falta cohortes completas antes y después.
