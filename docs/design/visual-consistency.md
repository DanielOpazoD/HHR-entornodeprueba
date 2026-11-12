# Consistencia visual incremental

## 1. Controles

- `Button` y `MedicalButton` comparten `buttonClassName` y `src/styles/controls.css`.
- Principal: acento del módulo; secundaria: neutral; destructiva: rojo explícito.
- Radio 8 px, alturas compactas de 28/32/36 px y controles táctiles de al menos 44 px.
- Foco visible de 2 px, estados deshabilitado, ocupado, inválido y solo lectura.
- Biblioteca adopta el sistema sin cambiar eventos, enlaces de descarga, datos ni plantillas PDF.
- Los estilos viven en la capa `components`: las excepciones locales deliberadas continúan siendo posibles.

No aplicar estos estilos a documentos oficiales o impresión. No modificar colores clínicos de estado para hacerlos coincidir con una marca. Las pruebas de formularios y navegación deben conservar borradores, foco y nombres accesibles.

## Validación

La prueba `Button.test.tsx` verifica contrato nativo, carga, foco, variantes y compatibilidad. El smoke de Biblioteca comprueba foco visible en el build real y guarda capturas con pacientes sintéticos. La validación visual debe incluir escritorio, ancho 1024 px y móvil; el censo conserva sus cuatro tarjetas en una fila a 1024 px.

## 2. Lectura y densidad

Biblioteca usa títulos de documento de 13 px y etiquetas, unidades y ayudas de 12 px, con interlineado relajado. Las cifras mantienen `tabular-nums`; las secciones dejan de depender de mayúsculas espaciadas. MEDIF y formularios ya no reducen ayudas ni etiquetas a 10/11 px.

El cambio se limita a la interfaz de Biblioteca: no altera el censo compacto de 1024 px, el tamaño de la plantilla oficial, ni la tipografía de documentos generados. No añade fuentes remotas ni dependencias.

## 3. Paneles y formularios

Cabecera compartida para herramientas de Biblioteca y modales: insignia de icono, título completo con ajuste de línea, acciones flexibles y cierre con geometría y foco comunes. No cambia el control de foco, Escape, confirmación de salida ni borradores.

Secciones con separación de 12 px y campos con ritmo de 8/12 px; no se reordenan campos clínicos ni se alteran agrupaciones semánticas. Las acciones y el título pueden envolver para evitar truncamiento. No se añade un pie fijo que tape campos o foco de teclado.
