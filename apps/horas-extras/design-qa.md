# Design QA — Hospitalizados, horas extras

**Final result: passed**

Revisión del prototipo local en `http://127.0.0.1:8799`, con datos ficticios.
No acredita un servicio productivo ni autenticación real.

## Fuentes y evidencia

Diseño combinado seleccionado: `exec-be83a1a7-12a9-4202-be3d-e27a4ab598c3.png`.
Referencias de detalle: `exec-74c1320b-f0ec-4a27-a3e5-13c99aa531c4.png`
(registro), `exec-df836688-184e-4263-9aa4-a83aca520e38.png` (calendario) y
`exec-8c3db56f-98ad-46d5-96b8-d29b2fd00e2d.png` (administración).
Directorio de fuentes local:
`/Users/daniel/.codex/generated_images/01a118b0-d17d-7110-917b-661c80150d0c/`.

Capturas definitivas, desde el navegador de Codex sobre el build de Vite:
`/Users/daniel/Documents/Codex/2026-10-07/n/outputs/`:

- `prototipo-calendario-movil.png`: 390 × 844 px, calendario personal en borrador.
- `prototipo-registro-movil.png`: 390 px de ancho, documento completo, noche del
  viernes 4 al sábado 5, 13 h = 1 diurna + 12 nocturnas/festivas.
- `prototipo-administracion.png`: 1440 × 1263 px, documento completo, revisión
  mensual con Luis Ejemplo seleccionado, enviado, 13 h = 1 + 12.

Viewport móvil 390 × 844 CSS px; escritorio 1440 × 1000 CSS px. Densidad efectiva
1 px/CSS px en las capturas. Referencias móviles 853 × 1844, reducidas a 390 × 843
sin alterar proporciones; referencia desktop 1487 × 1058, comparada a la misma
escala horizontal. Se compararon contenido y estados equivalentes, sin confundir
la mayor longitud del documento funcional con desbordamiento del viewport.

Comparaciones conjuntas en el directorio local `work/` de la misma sesión:
`comparacion-registro.png` (primera pasada), `comparacion-registro-final.png`,
`comparacion-calendario.png`, `comparacion-admin.png` y
`comparacion-admin-detalle.png`. La última contiene recortes a 424 px de ancho
para revisar tipografía, números, etiqueta nocturna y acciones del panel.

## Hallazgos y correcciones

- **P2, resuelto:** navegación y enlace de regreso redundantes desplazaban el
  formulario móvil. Se ocultan al registrar en celular, conservando Cancelar;
  superficie blanca y etiqueta de observación en una sola línea.
- **P2, resuelto:** Registrar turno quedaba fuera de la primera pantalla del
  calendario. Ahora permanece visible en celular; posición comprobada entre
  y=782 e y=830 en viewport de 844. Se reserva espacio al final para acceder a
  envío y descarga sin que el botón los tape.
- **P2, resuelto:** cambiar de pantalla podía conservar el desplazamiento de la
  anterior. El cambio de vista/formulario/acceso vuelve al inicio; comprobado
  `scrollY=0` al abrir el registro.
- **Comportamiento corregido:** fecha y hora usan el evento de entrada para
  recalcular inmediatamente también en el navegador integrado. Se probó el
  cambio del 4 al 17 y un intervalo de 17:30–21:30: 4 h = 3,5 + 0,5.

Las capturas posteriores a los ajustes eliminan los problemas anteriores.
No quedan diferencias P0/P1/P2 accionables dentro del alcance del prototipo.

## Superficies de fidelidad

- **Tipografía:** Outfit para títulos y cifras, Inter para controles; fuentes
  locales. Jerarquía y pesos conservados, sin truncar horarios o totales.
- **Espaciado:** tarjetas, separadores, selección de turno en tres columnas y
  revisión en tabla + detalle. El formulario incorpora un campo editable de
  fecha; la aprobación, el motivo de devolución y el cierre agregan contenido
  que no estaba desarrollado en los bocetos. No hay scroll horizontal del
  documento a 390 ni 1440 px. La tabla móvil tiene desplazamiento propio.
- **Color:** cabecera azul oscuro, acentos azul/cian y estados diferenciados con
  texto además de color. Botón principal algo más oscuro que el boceto para
  favorecer legibilidad; diferencia intencional.
- **Imágenes e iconos:** logo vectorial HHR suministrado por el repositorio,
  nítido y proporcional. Iconos coherentes de Lucide (sol/luna/reloj y acciones),
  sin reconstrucciones del logo ni imágenes de sustitución.
- **Texto:** unidad Hospitalizados, grupos TENS/Enfermería; aprobación de mes
  completo, no de turno. Totales coherentes con los datos reales del ejemplo.
  El aviso de demostración y el cambio de perfil son controles de esta etapa.

## Interacciones verificadas

Primer ingreso y cambio obligatorio simulado, rechazo posterior de la contraseña
inicial, calendario/lista, alta y edición, conflicto de horarios, víspera de
festivo, intervalos parciales, envío que retira edición, aprobación, declaración
sin extras, cierre rechazado con pendientes, cierre por Enfermera Diurna,
reapertura con motivo, devolución que recupera edición, exportación individual y
por grupo. Descargas XLSX verificadas en disco, abiertas de nuevo y renderizadas
con LibreOffice: hoja individual en una página con 38 / 14 / 24 horas en el caso
probado, noche en E, sin pie de página adicional ni cálculos auxiliares visibles.

Consola del navegador revisada: sin errores ni avisos en la prueba final.
Botones móviles de al menos 44 px en las acciones principales, etiquetas de
formulario, estados de error/éxito, foco visible y reducción de movimiento.

## Límites y continuación

Faltan pruebas en hardware iOS/Android real y auditoría exhaustiva con lector de
pantalla. El prototipo usa septiembre y estado en memoria. El encabezado de demo,
selector de perfiles, formulario de motivo y cierre explican las diferencias de
contenido respecto de las imágenes; no se declara equivalencia píxel a píxel.
El calendario mensual queda limitado al período validado y no muestra flechas
que aparenten navegar meses todavía no implementados.
