# Evidencia de usabilidad web en staging

Recorrido del 26 de noviembre de 2026, hora de Monterrey. Se usó la web pública de staging (`http://34.51.89.203`) en Chromium 156, con Playwright para interactuar con los controles y comprobar el resultado visible. Se probó a 1440 × 900 con una cuenta de prueba de Gerente de categoría y a 390 × 844 en una sesión sin autenticar. La referencia del repositorio al momento de la prueba fue `80c1008`. Los resultados corresponden a la interfaz servida por staging durante el recorrido.

La evaluación se realizó mediante tareas guiadas por un evaluador. El registro recoge los hallazgos positivos observados en el navegador.

| Tarea | Resultado observado |
| --- | --- |
| Identificar los controles de acceso | Los campos **Correo** y **Contraseña** se identificaron por sus etiquetas. **Mostrar contraseña** alternó a **Ocultar contraseña** y permitió volver al campo enmascarado. |
| Llegar a la sección de reportes | Al ingresar como Gerente de categoría, se pudo abrir **Reportes** desde el menú y localizar la acción **Generar reporte**. |
| Identificar los filtros de un reporte | El formulario mostró **Desde**, **Hasta** y **Zona (opcional)**. El **Historial** tuvo un encabezado propio, separado del formulario. |
| Consultar un reporte existente | Al abrir un reporte del historial por su periodo, se mostró su detalle y la sección **Archivos para descargar**, con acciones diferenciadas para preparar **PDF**, **Excel** y **CSV**. |
| Cerrar sesión | La opción **Cerrar sesión**, dentro de **Perfil**, devolvió al formulario de acceso. |
| Consultar el acceso en una pantalla estrecha | A 390 × 844, los dos campos y el botón **Ingresar** estuvieron visibles sin desplazamiento horizontal. |
| Abrir la recuperación de contraseña con el teclado | Al enfocar **¿Olvidaste tu contraseña?** y pulsar **Enter**, se abrió el formulario de recuperación con el campo **Correo**. La tarea terminó al llegar a esa pantalla. |
