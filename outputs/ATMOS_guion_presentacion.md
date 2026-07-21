# ATMOS - Guion de presentación

## Enfoque general

**Audiencia asumida:** jurado académico, autoridades universitarias, investigadores y potenciales aliados institucionales.

**Objetivo de comunicación:** al finalizar, la audiencia debe comprender que ATMOS convierte datos ambientales dispersos en un flujo analítico integrado, trazable y reproducible, con valor simultáneo para investigación, ciudadanía y toma de decisiones.

**Mensaje central:** ATMOS no es solo un dashboard; es una plataforma de extremo a extremo que integra adquisición, calidad de datos, análisis, modelado, evaluación y comunicación pública.

---

## Diapositiva 1 - Portada

### Texto visible

**ATMOS**

**Atmospheric Time-Series Modeling & Observation System**

Plataforma web de analítica ambiental para integrar, analizar y predecir datos de calidad del aire de Quito.

**Presentado por:** Gabriel Arguello | Joaquín Chacón

Universidad de Las Américas (UDLA) · Quito, Ecuador · 2026

### Recurso visual

Logo de ATMOS centrado o sobre un fondo oscuro con líneas sutiles que evoquen flujo de aire y series temporales. Mantener esta diapositiva limpia, como la portada de referencia.

### Mensaje del expositor

“ATMOS nace para transformar datos ambientales complejos en evidencia comprensible, reproducible y útil. La plataforma conecta el monitoreo ciudadano con herramientas avanzadas para investigación.”

---

## Diapositiva 2 - Contexto ambiental: Quito y la REMMAQ

### Texto visible

**Fuente pública de alto valor**

La Red Metropolitana de Monitoreo Atmosférico de Quito (REMMAQ) genera información histórica y datos actualizados de calidad del aire. El alcance actual de ATMOS trabaja con series multianuales, estaciones distribuidas en la ciudad y variables como PM₂.₅, PM₁₀, NO₂ y O₃.

**El desafío para investigación y ciudadanía**

El reto no es únicamente disponer de datos, sino convertirlos en evidencia reutilizable. Adquirir, depurar, homologar, explorar y modelar series ambientales exige trabajo técnico repetitivo, mientras la ciudadanía necesita información clara y accesible.

**Frase de valor:** ATMOS crea un puente entre los datos oficiales, la investigación académica y la comprensión pública del aire de Quito.

### Recurso visual

En la columna derecha, usar el mapa de estaciones o una captura del dashboard público. Incorporar de forma discreta los logotipos de UDLA, Quito y ATMOS.

### Mensaje del expositor

“La oportunidad consiste en aprovechar mejor una fuente pública valiosa. ATMOS busca que cada nueva investigación no tenga que empezar nuevamente desde la descarga y la limpieza de archivos.”

### Verificación antes de publicar

Si se desea usar la cifra “2004-2025” o “21 años de datos”, confirmar que todos esos periodos están disponibles y procesados en la versión que se demostrará.

---

## Diapositiva 3 - Identificación del problema

### Tarjeta 1 - Datos dispersos e ingesta frágil

Los archivos históricos, las fuentes actualizadas y las cargas manuales pueden tener formatos, estructuras y niveles de calidad diferentes. Esto ralentiza la consolidación y crea dependencia de procesos locales.

### Tarjeta 2 - Preparación repetitiva y baja reproducibilidad

El tratamiento de valores faltantes, la conversión de tipos, el mapeo de estaciones y variables y la aplicación de filtros suelen repetirse. Sin un pipeline trazable, es más difícil auditar y reproducir los resultados.

### Tarjeta 3 - Brecha entre análisis y decisión

La ciudadanía necesita indicadores comprensibles; los investigadores requieren análisis temporal y modelos avanzados. Sin un entorno compartido, el valor de los datos no escala entre proyectos ni audiencias.

### Frase de cierre

**El problema central no es la falta de datos, sino la fragmentación del ciclo que los convierte en conocimiento.**

### Recurso visual

Repetir la composición de tres tarjetas de la referencia, con iconos de base de datos desconectada, proceso manual y usuario/decisión.

---

## Diapositiva 4 - La solución: Plataforma ATMOS

### Texto visible

**Analítica ambiental integrada y reproducible**

ATMOS centraliza en un solo flujo web la ingesta, validación, almacenamiento, visualización, modelado y evaluación de datos. Integra sincronización con REMMAQ y carga de archivos CSV, XLSX o TXT, además de fuentes CSV por URL.

La plataforma permite tratar datos faltantes, explorar distribuciones y tendencias, analizar perfiles temporales, detectar anomalías, descomponer series, estudiar correlaciones y generar pronósticos.

El entorno avanzado habilita experimentos con ARIMA, SARIMA y Prophet, así como LSTM, GRU y Transformer. Los resultados incluyen métricas como RMSE y R², curvas de entrenamiento, predicciones, importancia de variables e intervalos de confianza del 95 %.

**Valor generado:** menos preparación repetitiva, mayor trazabilidad, metodología consistente, comparación transparente de modelos y comunicación pública más clara.

### Recurso visual

Usar una captura grande de ATMOS en la mitad derecha. Priorizar una vista que muestre el mapa público o el espacio analítico con una gráfica real; evitar maquetas si ya existe una pantalla funcional.

### Mensaje del expositor

“ATMOS conecta el ciclo completo. Un investigador puede pasar de la fuente a una conclusión sin cambiar de herramienta, y cada decisión de transformación queda vinculada al dataset y al workspace correspondiente.”

---

## Diapositiva 5 - Arquitectura del sistema

### Introducción visible

Arquitectura cliente-servidor modular, API-first y preparada para datos geoespaciales, con separación de responsabilidades para favorecer seguridad, reproducibilidad y evolución controlada.

### Tarjeta 1 - Plataforma web y API modular

La SPA React + TypeScript consume una API REST versionada en FastAPI. El backend orquesta autenticación, workspaces, ETL, dashboards y análisis bajo contratos validados. Incluye JWT, roles de administrador, investigador y usuario genérico, verificación de correo y recuperación de contraseña.

### Tarjeta 2 - Datos, analítica e infraestructura

PostgreSQL + PostGIS centraliza mediciones y metadatos. Cada workspace dispone de un esquema de base de datos y almacenamiento aislados. Los procesos de ingesta y entrenamiento se ejecutan como tareas desacopladas. Docker hace reproducible el entorno y Azure constituye la arquitectura objetivo de despliegue.

### Frase crítica de arquitectura

**ATMOS es hoy un monolito modular con tareas desacopladas; los servicios pueden separarse cuando la carga y la operación lo justifiquen.**

Esta formulación aporta más credibilidad que presentar microservicios sin una necesidad operativa demostrada.

### Recurso visual

Conservar dos tarjetas como en la referencia. En la primera, mostrar React/FastAPI/API; en la segunda, PostgreSQL/PostGIS, ETL/ML, Docker y Azure.

---

## Diapositiva 6 - Resultados de implementación

### Indicador 1 - 6 etapas integradas

**Ingesta y ETL → validación y normalización → repositorio → análisis y visualización → modelado → evaluación y reportes.**

ATMOS ya cubre el flujo funcional de extremo a extremo dentro del navegador.

### Indicador 2 - 222 verificaciones aprobadas en la validación local disponible

En la revisión realizada el 19 de julio de 2026 aprobaron **215 pruebas de backend** y **7 de 7 pruebas de frontend**. La compilación de producción del frontend también finalizó correctamente.

### Nota crítica obligatoria

No presentar todavía “100 % de aprobación”. El entorno local revisado no tenía PyTorch instalado: tres módulos de pruebas de LSTM, GRU y Transformer no pudieron recopilarse y cuatro casos dependientes no aprobaron por esa misma ausencia. Antes de la defensa o publicación, repetir la suite completa en el entorno oficial con todas las dependencias.

### KPIs que elevarían el valor de esta diapositiva

- Tiempo medio para preparar un dataset antes y con ATMOS.
- Porcentaje de ejecuciones reproducibles sin intervención manual.
- Latencia de actualización y porcentaje de sincronizaciones REMMAQ exitosas.
- Número de proyectos, investigadores y datasets procesados.
- Error de cada modelo: RMSE, MAE, R² e intervalos de confianza.
- Tiempo de entrenamiento e inferencia por algoritmo y volumen de datos.

### Recurso visual

Mantener dos tarjetas KPI como en la referencia. Usar “6 etapas integradas” y “222 verificaciones aprobadas”, con la nota técnica en un pie legible.

---

## Diapositiva 7 - Hoja de ruta: futuros pasos

### 1. Inmediato - Cierre técnico para producción

Validar la suite completa con PyTorch, automatizar todos los quality gates, asegurar HTTPS, rotación de secretos, copias de seguridad y pruebas de restauración. Incorporar MFA para administradores y cuentas sensibles.

### 2. Corto plazo - Ingesta resiliente y observabilidad

Fortalecer el acceso a REMMAQ con reintentos, caché, monitoreo de disponibilidad, alertas y un mecanismo estable de contingencia. Definir reglas de calidad, linaje, auditoría y SLA de frescura del dato.

### 3. Mediano plazo - MLOps y validación científica

Versionar datasets, transformaciones y modelos; incorporar registro de modelos, comparación contra baselines, reentrenamiento programado, detección de drift y model cards con supuestos, limitaciones y métricas.

### 4. Largo plazo - Escalabilidad y ecosistema abierto

Evaluar colas de trabajo, réplicas, GPU o mini-lotes según la demanda. Ampliar el análisis espacial con PostGIS, integrar sensores IoT y nuevas fuentes, y facilitar exportaciones y APIs alineadas con ciencia abierta y principios FAIR.

### Recurso visual

Repetir la línea de tiempo de cuatro hitos de la referencia. Diferenciar cada horizonte con una etiqueta pequeña: inmediato, corto, mediano y largo plazo.

---

## Diapositiva 8 - Conclusiones y recomendaciones

### Conclusión 1 - Ciclo analítico unificado

ATMOS integra adquisición, calidad, análisis, modelado y evaluación en un mismo entorno, reduciendo la fragmentación y haciendo más trazable la investigación.

### Conclusión 2 - Valor para dos audiencias

La combinación de un mapa público con workspaces analíticos permite atender a ciudadanía e investigadores sin duplicar la infraestructura de datos.

### Recomendación inmediata - Seguridad y operación

Completar la validación del entorno productivo, MFA, gestión segura de secretos, backups verificados, monitoreo, auditoría y pruebas de recuperación. La confiabilidad operativa debe ser parte del producto, no una actividad posterior.

### Recomendación de corto plazo - Evidencia e impacto

Ejecutar un piloto con investigadores, establecer una línea base de tiempo y esfuerzo, comparar modelos contra baselines simples y publicar limitaciones. Esto permitirá demostrar valor con resultados medibles y no solo con funcionalidades.

### Frase de síntesis

**ATMOS convierte datos ambientales dispersos en una capacidad institucional reutilizable para investigar, comunicar y decidir con evidencia.**

---

## Diapositiva 9 - Cierre

### Texto visible

**¿Preguntas?**

ATMOS convierte datos ambientales dispersos en evidencia reproducible para investigación, ciudadanía y decisión pública.

Gracias por su atención.

Gabriel Arguello | Joaquín Chacón

### Cierre oral sugerido

“La siguiente etapa no es agregar funciones sin dirección, sino demostrar impacto: cuánto tiempo ahorra ATMOS, qué tan reproducibles son sus resultados y cómo mejora la capacidad de comprender el aire de Quito.”

---

## Estructura visual equivalente a la referencia

1. Portada centrada y minimalista.
2. Contexto en dos columnas: texto + imagen o mapa.
3. Problema en tres tarjetas.
4. Solución en composición dividida: texto + captura del sistema.
5. Arquitectura en dos tarjetas principales.
6. Resultados en dos tarjetas KPI.
7. Hoja de ruta en línea de tiempo de cuatro hitos.
8. Conclusiones y recomendaciones en cuadrícula 2 × 2.
9. Cierre centrado con pregunta y mensaje de valor.

## Lineamientos visuales

- Formato 16:9.
- Fondo azul marino casi negro.
- Títulos en blanco con palabras clave en azul ATMOS.
- Verde turquesa para solución y resultados positivos.
- Texto secundario gris claro; no usar párrafos largos en pantalla.
- Usar capturas reales del sistema en lugar de imágenes genéricas.
- Mantener máximo una idea principal por diapositiva.
- Utilizar el logo ATMOS y, cuando corresponda, los logos de UDLA y Quito.

## Cifras opcionales que no deben publicarse sin validación

El material previo del proyecto menciona reducciones de 90-94 % en tiempo de preparación y una capacidad de 8-12 veces más proyectos por investigador. Son mensajes potentes, pero deben presentarse como **estimación** o **resultado de piloto** y acompañarse de:

- definición del proceso “antes” y “después”;
- tamaño y tipo de los datasets usados;
- número de participantes o proyectos observados;
- periodo de medición;
- método de cálculo y fuente de evidencia.

Sin esa trazabilidad, es preferible utilizar los KPIs técnicos verificados y explicar el plan de medición.

