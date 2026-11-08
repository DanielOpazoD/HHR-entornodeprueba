# Guía de Estilo y Estructura: Formulario de Solicitud de Laboratorio

Este documento detalla las especificaciones técnicas, estéticas y funcionales del formulario de Solicitud de Exámenes de Laboratorio del Hospital Hanga Roa.

## 🎨 Especificaciones Estéticas

### Tipografía y Legibilidad
- **Datos Autocompletados**: Se utiliza un tamaño de **17px** con peso **Extra Bold/Black** y transformación a **MAYÚSCULAS**. Esto garantiza que la información crítica del paciente sea legible incluso en impresiones de baja calidad o escaneos.
- **Ítems de Examen**: Tamaño de letra **11px** con un espaciado vertical (`py-0.5`) para facilitar la lectura y el marcado manual.
- **Títulos de Categoría**: Texto en negro sobre fondo blanco puro, con un borde inferior pronunciado (`border-b-2`).
- **Título Principal**: "Solicitud de Exámenes de Laboratorio Policlínico" en formato *Sentence Case* (Mayúscula inicial) para permitir que quepa en una sola línea horizontal.

### Paleta de Colores
- **Fondo**: Blanco puro (`bg-white`) en todas las secciones, incluyendo "Tubo Verde", para mantener la fidelidad con el formulario oficial de papel.
- **Bordes**: Negro sólido (`slate-900`) para las cuadrículas y divisiones principales.

## 🏗️ Estructura Técnica

### Distribución de la Cuadrícula
El formulario se divide en una cuadrícula de 12 columnas:
1.  **Columna 1**: Bioquímica y Tubo Verde.
2.  **Columna 2**: Hematología, Coagulación y Microbiológicos.
3.  **Columna 3**: Hormonas, Orina/Parásitos y Virología/Otros.

### Pie de Página (Footer)
- Incluye una columna específica para **Inmunología / Serología**.
- **Líneas del pie**: "Otros" (dos líneas) y "Médico Tratante" se pueden escribir antes de imprimir; el texto sale sobre la línea, sin bordes de campo. Vale solo para esa impresión: no se guarda con el paciente ni lo recuerda el navegador. "Firma" queda en blanco para firmar a mano.

### Varios pacientes
- En el censo diario, **Mayús + clic** sobre el nombre elige pacientes (o los quita); el botón flotante **«Orden de exámenes»** abre una solicitud con una pestaña por paciente. Esc o un clic en otra parte limpia la elección. Un clic normal sobre el nombre no cambia.
- Desde la solicitud de un paciente, **«+ Paciente»** agrega otros pacientes del censo del día como pestañas, y la **×** de cada pestaña lo quita.
- Cada pestaña guarda sus exámenes, "Otros" y "Médico Tratante" por paciente y episodio. **Imprimir N órdenes** saca todas en un solo documento, una hoja por paciente.
- Solo entran pacientes que un episodio o un documento identifica; uno identificado solo por el nombre (por ejemplo, un RN sin RUT) se imprime desde su propia fila. Nada se guarda: al cerrar, cambiar de usuario o de día, la elección y las pestañas se pierden.

## 🖨️ Optimización de Impresión (Print Logic)

### Eliminación de Ruido
- **Borrado de Título**: El sistema implementa un mecanismo de "borrado en caliente" que limpia `document.title` y el texto del encabezado del modal en el DOM justo antes de imprimir, evitando que aparezcan cabeceras del navegador o del portal.
- **Márgenes**: Configurado con un margen superior de **0mm** para aprovechar el 100% de la hoja desde el borde superior.

### Compatibilidad de Escalado
- Se utiliza `position: static` en los contenedores del modal durante la impresión para no interferir con los controles nativos de Chrome. Esto permite que el usuario ajuste manualmente la **"Escala"** en la ventana de impresión si fuera necesario.
- **Formato**: Optimizado para encajar perfectamente en una sola hoja **Tamaño Carta (Letter)**.

### Fidelidad Visual
- Se utiliza `WebkitPrintColorAdjust: exact` para asegurar que los "tickets" (flechas de selección) se vean negros y sólidos en la impresión y en el PDF.

---
*Nota: Este diseño busca la paridad total con el formulario físico utilizado históricamente en la institución.*
