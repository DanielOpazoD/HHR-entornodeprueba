# Saneamiento de la suite de pruebas

Base de implementación: `37908ac1f76f0c39015b76f0ce28001c6c7f057d`.
El objetivo es detectar regresiones con menos ruido y conocer qué se ejecuta.
El número de casos o archivos no es un objetivo de calidad.

## Contratos reparados

| Área              | Cambio                                                                                                                                     | Regresión que debe detectar                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Storage           | Ejecutar los siete casos existentes contra emuladores Firestore y Storage en PR y release confidence; excluirlos del unitario sin emulador | Pérdida de permisos de adjuntos, controles MIME/tamaño o rechazo anónimo |
| Dispositivos      | Exigir exactamente el conjunto activo del lado preferido; contraejemplos disjuntos en ambas preferencias                                   | Unión filtrada que reincorpora un dispositivo del lado descartado        |
| Documento clínico | Exigir el orden de secciones y sus posiciones después de MOVE_SECTION en ambas direcciones                                                 | Reducer que acepta la acción sin mover nada                              |
| Adjuntos          | Invalidar fileKind y sizeBytes por separado desde un registro válido                                                                       | Una validación ausente escondida por la otra                             |
| Cola              | Separar drain/retry determinista de volumen y tiempo nocturnos                                                                             | Pérdida, repetición de escritura ya confirmada o reintento que no drena  |
| Cobertura         | Conservar baselines instrumentados y fallo por fuente sin instrumentar; conteos informativos                                               | Consolidación bloqueada sólo por disminuir archivos                      |

Las reglas de permisos y el código clínico de producción no cambian. La revocación
con token ya emitido conserva también la suite de cuentas con emuladores.

## Retiradas con reemplazo identificado

| Retirada                                                                                            | Protección retenida que importa producción                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siete casos de `validation/admissionDates.test.ts`, que usaban regex, split y comparaciones locales | `schemas/validation.test.ts`: validateAdmissionDate y formatos concretos; `utils/dateUtils.test.ts`: isFutureDate con reloj fijo y parseISODate con componentes UTC; `utils/clinicalDateUtils.test.ts`: cambio de año en ambos sentidos |
| Ocho longitudes de arrays AuditAction en `types/audit.test.ts`                                      | Tipo productivo y consumidores bajo typecheck; registry real en `build/clinicalMutationAuditPolicyScript.test.ts`. Se conservan los nueve casos maskRut                                                                                 |
| Caso único de `views/handoff/handoffScreenController.test.ts`                                       | Mismos input y seis aserciones en `application/handoff/handoffScreenReadModel.test.ts`, sobre resolveHandoffMedicalScreenState                                                                                                          |

El conjunto dirigido pasó 140/140 antes y 124/124 después, en ocho y seis archivos.
Son 16 casos registrados retirados; no es una medición del ahorro global de CI.
Los formatos y el cambio de año se trasladaron a APIs reales, sin crear otro validador.

## Evidencia de los oráculos

Los tres archivos reparados pasaron 37/37 casos con Vitest real y Node.js 22.
Una comprobación adicional con Vitest real, en una copia temporal aislada, rechazó
las cuatro mutaciones. Pasó el original (37/37) y fallaron las aserciones dirigidas:
tres para dispositivos, dos para MOVE_SECTION y una por cada campo de adjuntos.
La copia se eliminó al terminar.

Una comprobación previa sustituyó módulos sólo en memoria con esbuild:
la unión filtrada, MOVE_SECTION sin efecto, fileKind libre y sizeBytes sin límite
fueron rechazados por sus aserciones correspondientes. Los módulos originales
pasaron. El adaptador usa node:assert y la propiedad empleó 1.000 entradas con
semilla 20261021. Es una comprobación dirigida, no un mutation score de la suite.

## Ejecución y E2E

El manifiesto distingue inventario, colección y ejecución observada. No suma
corridas solapadas. Conserva SHA completo y huella de cambios locales; rechaza
reportes ajenos al árbol probado. Su alcance automático está en
[README de pruebas](README.md#54-inventario-y-ejecución-por-árbol-probado).

Cada spec E2E tiene decisión explícita en `scripts/config/e2e-test-ownership.json`.
Los escenarios manuales y candidatos a retirada se conservan: no basta que no
aparezcan literalmente en un workflow para considerarlos inútiles. El PDF smoke
no ejecutado por CI tampoco se cuenta como ahorro.

## Observación de CI en tres corridas

Se compararon tres pushes exitosos a main del mismo workflow el 21 de octubre de 2026.
Los commits difieren; son una línea base observacional, no un experimento antes/después.
Los tiempos incluyen los pasos de cada job, sin atribuirlos todos al motor de tests.

| Run                                                                                         | Arranque development | Unitario más lento | Job más lento                            |
| ------------------------------------------------------------------------------------------- | -------------------: | -----------------: | ---------------------------------------- |
| [39541422837](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/39541422837) |              1.012 s |              354 s | census-startup-performance (development) |
| [39549398349](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/39549398349) |              1.195 s |              402 s | census-startup-performance (development) |
| [39562976123](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/39562976123) |              1.415 s |              342 s | census-startup-performance (development) |

En estas tres corridas, reducir unitarios no habría acortado el job más lento.
Se conservan las ejecuciones separadas de unitarios y cobertura: su consolidación
necesita comparar instrumentación, aislamiento y costo, además de demostrar que no
se pierde protección. Este cambio no promete una aceleración global.

## Criterios para futuras retiradas

1. Identificar el comportamiento observable y su prueba retenida que llama a producción.
2. Preservar permisos, fallos de transporte, concurrencia, replay, compatibilidad y privacidad.
3. Cuando el oráculo es débil, repararlo y demostrar un contraejemplo rechazado.
4. Retirar únicamente equivalencia demostrada, lógica local sin consumidor o contratos desaparecidos.
5. Comprobar suites pertinentes y el gate del repositorio; no sustituirlos por un conteo.

## Verificación local integrada

- La primera corrida unitaria completa registró 16.110 casos: 16.103 aprobados,
  seis `todo` y un fallo en la comparación literal de un comando del workflow.
  El comando seguía ejecutándose dentro del capturador. Se corrigió esa comprobación;
  sus cuatro archivos dirigidos pasaron 32/32. Esto no se presenta como un pase
  local completo del head final: Actions vuelve a ejecutar toda la suite publicada.
- La cobertura instrumentada pasó 3.964 casos en 711 archivos y las 16 zonas
  conservaron sus baselines. El gate no necesitó recuperar Load en PR.
- El build, sus budgets y la validación de preview pasaron; Chromium ejecutó
  61/61 casos sobre el bundle real.
- La revisión independiente detectó y reprodujo fallos del capturador: flags del
  comando hijo, fallos de afterAll, entradas sin ejecución y membresía no comparada.
  Las regresiones del manifiesto prueban esos casos, productores y archivos exactos,
  intentos anteriores válidos, y reportes incompletos sin perder su diagnóstico.

Las capturas distinguen siete productores obligatorios: cuatro unitarios, Storage,
E2E crítico y performance de flujo. El inventario fuera de ese alcance permanece
explícitamente sin observación. Ningún listado se convierte en ejecución aprobada.
