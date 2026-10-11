# Requerimientos funcionales y no funcionales

> Fuente: *Documento de Planeación del Proyecto* (26-ago-2026), sección 6 y 7.
> El texto de cada RF es **literal**. Las columnas "Servicio" y "Decisión / nota"
> son agregadas para agentes y revisores.
>
> Precedencia: decisiones de negocio (`docs/matriz-perfiles-permisos.md` §4) >
> Matriz de permisos > **este archivo** > reglas de negocio
> (`docs/reglas-negocio.md`) > contratos. Una contradicción se reporta, no se
> resuelve en silencio.
>
> **PENDIENTE (P-xx)** remite a `docs/matriz-perfiles-permisos.md` §6.

## 1. Requerimientos funcionales

### 1.1 Catálogos y precios

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-01 | El sistema debe permitir el registro y consulta de tiendas. | catalog-service | D-07: con historial de precios solo se desactiva. |
| RF-02 | El sistema debe permitir la clasificación de zonas geográficas. | catalog-service | Clasificación manual o por corrida de clustering (`zona_clasificaciones`). |
| RF-03 | El sistema debe permitir el registro y consulta de productos. | catalog-service | D-08: pendiente/rechazado no existe para el resto. |
| RF-04 | El sistema debe permitir el registro y actualización de precios. | pricing-service | Histórico solo se anexa. D1, D-05, D-09. |
| RF-05 | El sistema debe permitir la definición de segmentos de ingreso. | catalog-service | D-10: rangos encimados se rechazan. |
| RF-35 | El sistema deberá permitir registrar distintas presentaciones o empaques de un mismo producto. | catalog-service | 1-a-muchos; precios y ventas apuntan a la presentación. |
| RF-27 | El sistema debe permitir comparar precios entre zonas. | pricing-service | D-06: por presentación y normalizado por kg/L. |

### 1.2 Acceso y proveedores

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-06 | El sistema debe gestionar perfiles y permisos diferenciados (Administrador, Analista comercial, Gerente de categoría, Responsable de precios, Planeador, Auditor). | auth-service | Desactualizado: falta `Proveedor` (ya existe) e `Investigador de mercado` (P-01). |
| RF-07 | El sistema deberá permitir la autenticación de usuarios según su perfil, restringiendo el acceso a las funciones correspondientes a cada rol. | auth-service + todos | JWT + sesión activa en Redis en cada servicio. |
| RF-12 | El sistema deberá permitir la integración de proveedores, para que registren y oferten sus productos. | auth (alta), catalog (productos), pricing (precios) | D-08, D-11, D1. |

### 1.3 Transacciones y canastas

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-08 | El sistema debe permitir la integración y consulta de transacciones. | core-process-service | Manual y por CSV. |
| RF-09 | El sistema debe permitir la construcción de canastas de consumo. | core-process-service | Una canasta = una transacción. |
| RF-10 | El sistema deberá permitir consultar canastas de consumo filtradas por zona, segmento de ingreso o rango de fechas. | core-process-service | |
| RF-11 | El sistema deberá identificar y clasificar canastas correspondientes a productos de canasta básica. | core-process-service | Composición de la canasta básica: D-03. |

### 1.4 Algoritmos y estadística

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-13 | El sistema debe generar reglas de asociación entre productos (Apriori). | algorithms-core | D3 (Mongo), D-15 (reproducible). |
| RF-14 | El sistema debe generar reglas de asociación entre productos (FP-Growth). | algorithms-core | D2. Mismas reglas que Apriori con los mismos datos. |
| RF-15 | El sistema deberá permitir configurar los parámetros mínimos de soporte y confianza antes de ejecutar los algoritmos de asociación. | algorithms-core | D-17: (0, 1], umbral `>=`. |
| RF-16 | El sistema deberá permitir agrupar zonas o segmentos mediante algoritmos de clustering según patrones de consumo similares. | analytics-stats | D3. Nunca agrupar personas. |
| RF-17 | El sistema deberá identificar patrones de sustitución entre productos dentro de una misma categoría. | algorithms-core | Método: ver RN-11 (PENDIENTE). |
| RF-18 | El sistema debe calcular la elasticidad precio-demanda. | algorithms-core | D-18: unitaria si 0.95 ≤ \|E\| ≤ 1.05. |
| RF-19 | El sistema deberá permitir visualizar la elasticidad calculada mediante gráficos comparativos por zona o segmento. | algorithms-core + web | Highcharts en web. |
| RF-20 | El sistema deberá ejecutar pruebas de hipótesis para validar diferencias de comportamiento de compra entre segmentos. | analytics-stats | |
| RF-21 | El sistema deberá ejecutar análisis de varianza (ANOVA) para comparar el comportamiento de compra entre más de dos zonas o segmentos. | analytics-stats | |
| RF-22 | El sistema deberá permitir la comparación de proporciones entre segmentos. | analytics-stats | |

### 1.5 Decisión: accesibilidad, simulación y recomendaciones

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-23 | El sistema debe calcular indicadores de accesibilidad a productos básicos. | decision-service | D-02, D-03, D-04. Indicador analítico, no medida de bienestar. |
| RF-24 | El sistema debe permitir simular estrategias de precio. | decision-service | D-01: elasticidad constante (826 / −9.1 % en el caso de referencia). |
| RF-25 | El sistema debe permitir simular estrategias de empaque. | decision-service | D-14: todas las presentaciones del mismo producto. |
| RF-26 | El sistema deberá permitir comparar distintos escenarios de simulación entre sí. | decision-service | |
| — | Recomendaciones comerciales inclusivas (objetivo del proyecto, sin RF propio). | decision-service | D-12, D-13. Qué, por qué, con qué datos, qué impacto. |

### 1.6 Reportes y auditoría

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-28 | El sistema debe generar reportes ejecutivos. | documents-service | D-20: 16 indicadores; no disponible ≠ 0. |
| RF-29 | El sistema deberá permitir exportar los reportes generados en formatos estándar (PDF, Excel). | documents-service | D-19: Excel después del 13-oct. |
| RF-30 | El sistema deberá permitir al Auditor consultar el historial (bitácora) de cambios realizados sobre precios, productos y estrategias comerciales. | audit-service | Bitácora inmutable. |
| RF-31 | El sistema debe registrar la auditoría de las acciones de los usuarios. | audit-service + todos | Fire-and-forget, no bloqueante. RN-13 pide rol y antes/después. |

### 1.7 Aplicación móvil (JSON exclusivo)

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-32 | El sistema deberá permitir la autenticación del personal de investigación de mercado dentro de la aplicación móvil. | auth-service | Rol: P-01. |
| RF-33 | La aplicación móvil debe permitir levantar precios. | pricing-service | D-16: pasa a aprobación; origen "campo" en auditoría. P-02. |
| RF-34 | La aplicación móvil debe permitir escanear productos. | catalog-service | `codigo_barras` único por presentación. P-08. |
| RF-36 | La aplicación móvil debe permitir capturar disponibilidad. | P-03 | Fuente de "baja disponibilidad" (D-13). |
| RF-37 | La aplicación móvil debe permitir capturar ubicación. | P-03 | |
| RF-38 | La aplicación móvil debe permitir aplicar encuestas. | P-03 | |
| RF-39 | La aplicación móvil debe permitir trabajar sin conexión. | mobile | |
| RF-40 | La aplicación móvil debe permitir sincronizar resultados. | mobile + servicios destino | |

### 1.8 Aplicación de escritorio (XML exclusivo, validado con XSD)

| ID | Requerimiento | Servicio | Decisión / nota |
|---|---|---|---|
| RF-41 | El sistema deberá permitir la autenticación de los analistas dentro de la aplicación de escritorio. | auth-service | Roles: P-04. |
| RF-42 | La aplicación de escritorio debe permitir importar ventas. | core-process-service | |
| RF-43 | La aplicación de escritorio debe permitir configurar segmentos. | catalog-service | |
| RF-44 | La aplicación de escritorio debe permitir ejecutar reglas de asociación. | algorithms-core | |
| RF-45 | La aplicación de escritorio debe permitir analizar la elasticidad. | algorithms-core | Analista solo tiene Lectura en Elasticidad: P-04. |
| RF-46 | La aplicación de escritorio debe permitir comparar zonas. | catalog / pricing | |
| RF-47 | La aplicación de escritorio debe permitir simular cambios de empaque y descuentos. | decision-service | Simulación es Total solo para Planeador: P-04. |
| RF-48 | La aplicación de escritorio debe permitir exportar tablas y reportes. | documents-service | |

## 2. Requerimientos no funcionales

| ID | Requerimiento |
|---|---|
| RNF-01 | Seguridad: autenticación mediante JWT y control de acceso basado en roles. |
| RNF-02 | Escalabilidad: el sistema debe soportar el crecimiento del volumen de transacciones mediante una arquitectura de microservicios en contenedores. |
| RNF-03 | Disponibilidad: los ambientes de staging y producción deben mantenerse disponibles para las demostraciones programadas. |
| RNF-04 | Rendimiento: tiempos de respuesta aceptables bajo pruebas de carga (Locust). |
| RNF-05 | Portabilidad: despliegue reproducible en GCP mediante contenedores Docker en los ambientes developer, staging y production. |
| RNF-06 | Usabilidad: interfaces diferenciadas y claras según el perfil de usuario. |
| RNF-07 | Mantenibilidad: código modular y documentado, con pruebas unitarias e integración. |
| RNF-08 | Interoperabilidad: comunicación entre servicios mediante contratos JSON (OpenAPI/Swagger) y esquemas XML/XSD. |
| RNF-09 | Observabilidad: panel de monitoreo y health checks por microservicio. |
| RNF-10 | Operación sin conexión: la aplicación móvil debe funcionar offline y sincronizar al recuperar conexión. |

## 3. Requisitos del profesor para el Parcial 2 (no recortables)

- Cada microservicio: responsabilidad única, contenedor propio, rutas versionadas,
  validación, autenticación, autorización, **JSON y XML**, error estandarizado,
  registro de actividad, `GET /health`, OpenAPI con ejemplo JSON y XML.
- Contratos JSON (estructura, tipos, obligatorios/opcionales, códigos HTTP, errores,
  paginación, versión) y XML (elementos, atributos, jerarquía, tipos, **XSD**,
  errores, codificación, namespaces).
- App móvil: JSON exclusivo, token seguro, renovación de sesión, menú por rol,
  **≥ 4 microservicios**, indicador de conexión, **≥ 2 capacidades del dispositivo**.
- App de escritorio: XML exclusivo validado con XSD, menú por perfil,
  **≥ 4 microservicios**, tabla, búsqueda, filtros, exportación; **no** copia de la web.
- MongoDB real: inserción, consulta, actualización, agregación, indexación, filtrado,
  recuperación por identificadores relacionados.
- Redis real; **todos** los componentes lo consultan al autenticar/autorizar.
- Demo: móvil (JSON) → microservicio valida JWT → Redis valida sesión → Postgres/Mongo
  → web muestra → escritorio consulta por XML → Swagger muestra el contrato.
