# Revisión visual: Moa y barra compacta

final result: passed

Moa conserva la opción 2 elegida: piedra gris, cabeza alargada, ojos simples y
una pequeña ola turquesa sobre el torso. El primer cuadro usa esa imagen;
los cinco restantes añaden parpadeo, atención, saludo, pensando y sonrisa.
Las seis poses comparten el anclaje de los pies y dejan espacio para las manos.
Las animaciones terminan en reposo y se desactivan con movimiento reducido.

La barra azul mide 52 px en escritorio y 48 px en teléfono, frente a 64/56 px.
La marca usa 14 px y la navegación 13 px, en armonía con el censo.
Se elimina el separador vertical. El nuevo paisaje representa moáis con
cabezas y torsos más alargados; se oculta en pantallas estrechas para dejar
espacio a los controles. Su URL nueva evita reutilizar el paisaje anterior.

## Comparación y evidencia

Capturas con datos sintéticos, Chromium y deviceScaleFactor 1:

- Fuente elegida: `/workspace/generated_images/exec-631c10c8-dfa2-4f36-bcd9-c6b4855fb726.png`.
- Comparación conjunta de fuente y mascota renderizada: `/workspace/.hhr-cloud/evidence/moa-final/moa-source-and-render.png`. La fuente se normaliza a la altura del personaje; la captura de 56 px se amplía 2× para inspección. Se conservan proporciones y contorno; no se atribuye una densidad desconocida a la fuente.
- Barra anterior y actual: `/workspace/.hhr-cloud/evidence/moa-final/header-before-and-after.png`.
- Mascota visible: `/workspace/.hhr-cloud/evidence/moa-final/moa-shown-375px.png` y `moa-shown-1440px.png`.
- Mascota oculta: `/workspace/.hhr-cloud/evidence/moa-final/moa-hidden-375px.png` y `moa-hidden-1440px.png`.
- Carga antes de React: `/workspace/.hhr-cloud/evidence/moa-final/new-navbar-preboot.png`. La superficie vacía comparte altura, colores y nueva imagen con la aplicación.
- Censo y cunas antes/después de F5: `/workspace/.hhr-cloud/evidence/moa-final/new-navbar-and-newborn.png` y `new-navbar-after-reload.png`.
- Resultados: `/workspace/.hhr-cloud/evidence/moa-ready-tests/report.json`.

## Validación

Se revisaron tipografía, proporciones, espaciado, color, imágenes, contenido,
foco y adaptación en 375, 768, 1280, 1440 y 1672 px. Los menús, Documentos,
los encabezados fijos y las cunas conservan sus interacciones y alineación.
El panel admite desplazamiento en una pantalla de 375 × 340 px y no se imprime.

Pasaron 22 pruebas de navegador y 59 pruebas unitarias, TypeScript, ESLint de
los archivos modificados, formato, arquitectura, límite del runtime del censo,
compilación, presupuesto de carga y grafo de chunks. Se comprobaron seis
posiciones distintas, una sola repetición, retorno al reposo, movimiento
reducido, preferencia persistida, almacenamiento indisponible y descarga fallida.

El precache mide 4.951.992 bytes con un límite de 4.952.064: permanece cerca
del límite, sin ampliarlo. La ilustración opcional se almacena al usarla;
la ayuda mantiene una alternativa si la imagen no está disponible.

Browser plugin not available: se utilizó Playwright con Chromium local.
La revisión corresponde a la interfaz con fixtures sintéticos; no certifica
flujos clínicos ni sesiones reales de Eloísa. No quedan diferencias P0/P1/P2
pendientes respecto del alcance elegido; las nuevas poses y la densidad menor
son cambios solicitados, no una afirmación de igualdad de píxeles.
