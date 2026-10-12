# Revisión visual: Moa en el censo y paisaje panorámico

final result: passed

## Fuentes y comparación

La referencia de ubicación es la imagen de camas/movimientos adjunta por el
usuario: Moa debe aprovechar el espacio libre junto a esa tarjeta. La otra
imagen identifica el panel de texto que se elimina. El personaje conserva
la opción 2 elegida; no se redefine su aspecto.

- Fuente del personaje: `/workspace/generated_images/exec-631c10c8-dfa2-4f36-bcd9-c6b4855fb726.png` (1280 × 1280, transparente; no se presupone una densidad de captura).
- Fuente del censo anterior: `/workspace/.hhr-cloud/evidence/moa-final/new-navbar-and-newborn.png`.
- Implementación: `/workspace/.hhr-cloud/evidence/moa-companion-final/new-navbar-and-newborn.png`.
- Comparación conjunta completa: `/workspace/.hhr-cloud/evidence/moa-companion-final/full-view-comparison.png`.
- Comparación de cabecera y RN: `/workspace/.hhr-cloud/evidence/moa-companion-final/header-and-rn-comparison.png`.
- Detalle de la ubicación: `/workspace/.hhr-cloud/evidence/moa-companion-final/moa-summary-detail.png`.
- Móvil: `/workspace/.hhr-cloud/evidence/moa-companion-final/moa-companion-375px.png`.
- Paisaje y exportación: `/workspace/.hhr-cloud/assets/rapa-nui-coast-v3-comparison.png`.

Los dos censos completos se capturaron en 1672 × 941 CSS px, Chromium, DPR 1,
mismo módulo y fecha, sin zoom. La comparación junta ambos archivos originales
(3344 × 941 px); el recorte de cabecera apila regiones de 1672 × 440 px sin
reescalar. Los pacientes son sintéticos. La implementación añade una segunda
cama/cuna con nombre largo para comprobar alineación; las cifras del resumen y
la altura de la tabla cambian por ese fixture y no son objetivos de igualdad.
La imagen proporcionada de camas/movimientos se usa para la ubicación, no para
atribuirle una densidad desconocida ni igualar cifras de pacientes.

## Resultado y cambios verificados

El paisaje ocupa hasta 430 × 52 px frente a los 270 px anteriores, conservando
las proporciones de los moáis. La URL v3 se usa también antes de React y después
de F5. La barra mantiene sus 52/48 px y los controles no quedan tapados.

Moa dispone de 144 × 84 px junto al resumen y una ilustración de 72 px de alto.
En teléfono ocupa la fila siguiente para mantener legibles las cifras. Su
botón de la barra es (?), sin panel de texto. Mostrar/ocultar persiste con F5;
la X y Escape devuelven el foco al botón. Hay saludo inicial, respiración y
parpadeo discretos, curiosidad al acercarse, paseo y alegría al tocarla.
La pausa y el movimiento reducido se respetan, y no aparece al imprimir.

Los RN presentan la etiqueta en mayúsculas sin alterar la identidad guardada.
Su ficha clínica se ancla a la primera línea, en la misma columna que las
camas normales. La geometría coincide dentro de 1 px también frente a un
nombre que ocupa varias líneas. Las cunas no incorporan exámenes ni imágenes.

## Iteraciones y hallazgos

1. P2: el área pulsable se movía con la ilustración e impedía una pulsación
   estable durante el reposo animado. Se dejó fijo el botón y se trasladaron
   los movimientos a su contenido. La suite completa posterior aprobó los
   gestos, la navegación y los controles; la revisión final mantuvo ese resultado.
2. Se redujo la repetición de reglas CSS manteniendo gestos y duraciones. Una
   comprobación de expresión leía el estilo antes de completar la actualización
   de React; ahora espera el gesto y la expresión visibles. La comprobación
   final del mismo código aprobó pausa, cuatro gestos y movimiento reducido.

No quedan hallazgos P0/P1/P2. No se representa IA ni se dan instrucciones clínicas
mediante la mascota. La ayuda textual se elimina como solicitó el usuario.

## Validación y límites

Flujo: abrir el censo -> (?) muestra/oculta Moa -> tocar o enfocar cambia su
comportamiento -> pausar, ocultar y recargar conserva el control esperado.

Pasaron 60 pruebas unitarias y las 22 pruebas completas de navegador del censo
y biblioteca. Después del último ajuste CSS se comprobaron nuevamente las
siete rutas afectadas y la prueba de gestos, que terminó aprobada con la espera
del estado visible. Se revisaron 375, 768, 1280, 1440 y 1672 px, y 375 × 340 px.
Se verificaron contenido, navegación, ausencia de errores fatales de framework,
consola en los flujos normales, imágenes y código indisponibles, foco, impresión,
movimiento reducido y recarga. Los errores de descarga de las pruebas negativas
son deliberados y están contenidos; no se sustituyen por una afirmación de cero
mensajes en esas pruebas.

También aprobaron TypeScript, ESLint de los archivos modificados, formato,
arquitectura, límites del censo, compilación, presupuesto y grafo de chunks.
El precache final mide 4.951.929 de 4.952.064 bytes (135 bytes de margen): sigue
muy cerca del límite sin ampliarlo ni excluir más código. La ilustración
opcional conserva el caché de imágenes existente.

Browser plugin not available: se utilizó el Playwright/Chromium ya instalado.
La revisión usa fixtures sintéticos; no certifica sesiones reales de Eloísa.
Resultados: `/workspace/.hhr-cloud/evidence/moa-companion-ready/report.json`,
`/workspace/.hhr-cloud/evidence/moa-companion-final/report.json` y
`/workspace/.hhr-cloud/evidence/moa-companion-gestures-final/report.json`.
