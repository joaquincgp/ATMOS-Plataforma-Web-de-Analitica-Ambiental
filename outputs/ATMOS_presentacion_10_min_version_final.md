# ATMOS - Presentación integral de 10 minutos

## Propósito de la defensa

La presentación debe demostrar una idea central:

> ATMOS transforma datos atmosféricos públicos, dispersos y heterogéneos en un flujo integrado, trazable y reproducible para investigación, análisis predictivo y consulta ciudadana.

La exposición no debe convertirse en una lista de tecnologías. El hilo conductor recomendado es:

**problema real → flujo que hoy falla → solución funcional → decisiones arquitectónicas → evidencia → límites → siguiente etapa.**

## Distribución exacta del tiempo

| Diapositiva | Tema | Tiempo |
|---|---|---:|
| 1 | Apertura y propuesta de valor | 0:25 |
| 2 | Contexto de Quito y oportunidad de los datos | 0:55 |
| 3 | Problema y proceso AS-IS | 1:05 |
| 4 | Solución funcional y actores | 1:00 |
| 5 | Arquitectura integral | 1:20 |
| 6 | Flujo técnico de datos, analítica y ML | 1:05 |
| 7 | Seguridad, persistencia y despliegue | 0:55 |
| 8 | Resultados y pruebas | 1:20 |
| 9 | Limitaciones y trabajo futuro | 1:10 |
| 10 | Conclusiones y cierre | 0:45 |
| **Total** |  | **10:00** |

---

## Diapositiva 1 - ATMOS: de datos dispersos a evidencia útil

### Texto visible

**ATMOS**

Plataforma web de analítica ambiental para investigación y comprensión de la calidad del aire de Quito.

**Datos oficiales → preparación → análisis → predicción → comunicación**

Joaquín Chacón · Gabriel Arguello · UDLA · 2026

### Guion oral

“En Quito existen datos valiosos sobre calidad del aire, pero su valor científico y social depende de poder convertirlos en evidencia comprensible y reproducible. ATMOS integra ese proceso completo: desde la obtención y limpieza de los datos hasta el análisis, el modelado predictivo y la visualización pública.”

### Recurso visual

Portada limpia con el logotipo de ATMOS y una captura tenue del mapa público. No colocar párrafos ni el diagrama completo de arquitectura.

### Transición

“Para entender por qué esta integración es necesaria, primero debemos mirar el contexto de los datos ambientales de Quito.”

---

## Diapositiva 2 - Contexto: el dato existe, pero no llega listo para generar conocimiento

### Texto visible

**Quito necesita análisis ambiental continuo**

- La topografía, la altitud, el parque automotor y otras fuentes de emisión hacen compleja la dinámica del aire.
- La REMMAQ monitorea contaminantes y variables meteorológicas en estaciones de la ciudad.
- Los datos oficiales constituyen un activo público valioso, pero se publican en archivos y estructuras heterogéneas.

**La oportunidad:** conectar datos oficiales, investigación académica y comprensión ciudadana.

### Guion oral

“Quito se encuentra en un valle andino, a gran altitud y con una dinámica atmosférica influida por su topografía y sus fuentes de emisión. La REMMAQ produce información oficial sobre contaminantes como PM2.5, PM10, dióxido de nitrógeno, ozono y variables meteorológicas. El problema no es que los datos no existan. El problema es que se distribuyen mediante archivos históricos y fuentes que no ofrecen una API oficial ni garantías de disponibilidad. Por eso, pasar del dato publicado a una conclusión científica exige demasiado trabajo manual.”

### Recurso visual

Usar una captura del mapa público implementado, correspondiente a la Figura 59 del documento (p. 286 del PDF). Acompañarla con tres etiquetas: **fuente oficial**, **investigación**, **ciudadanía**.

### Fuente en el documento

Problema y contexto: pp. 10-15. Resultados del tablero público: pp. 285-286.

### Transición

“Esa dificultad se expresa en tres problemas concretos dentro del proceso de investigación.”

---

## Diapositiva 3 - Problema: fragmentación, trabajo manual y baja reproducibilidad

### Texto visible

**1. Datos fragmentados y heterogéneos**

Archivos RAR/ZIP y hojas de cálculo con nomenclaturas, formatos y coberturas diferentes; sin API oficial.

**2. Preparación manual y repetitiva**

Búsqueda, descarga, consolidación, limpieza y validación mediante hojas de cálculo y scripts aislados.

**3. Análisis y comunicación desconectados**

Poco tiempo para investigar, baja trazabilidad y una experiencia pública limitada para interpretar la calidad del aire.

**Proceso AS-IS estimado: 160-320 horas por estudio; 70-75 % se concentra en preparación y validación.**

### Guion oral

“El proceso actual es lineal y depende de trabajo especializado repetitivo. Cada investigador debe localizar archivos, descargarlos, unificar nombres, convertir fechas y unidades, tratar valores faltantes y documentar decisiones. Según el levantamiento del proyecto, una investigación típica puede demandar entre 160 y 320 horas, y entre el 70 y el 75 por ciento se consume antes del análisis científico. Esto también reduce la reproducibilidad: dos personas pueden preparar la misma fuente con reglas diferentes, y cada proyecto tiende a empezar casi desde cero. Finalmente, la ciudadanía recibe información limitada y difícil de interpretar.”

### Visual recomendado

Un flujo horizontal de seis etapas, con las cuatro primeras en color de problema:

**buscar → descargar → consolidar → limpiar → analizar → comunicar**

Debajo, destacar: **115-240 horas en obtención, preparación y validación**.

### Precisión importante

Las cifras de tiempo provienen de estimaciones del proceso AS-IS documentadas con investigadores. No presentarlas como una medición experimental controlada.

### Fuente en el documento

Descripción del problema y proceso AS-IS: pp. 13-20. Comparación AS-IS/TO-BE: pp. 90-92.

### Transición

“ATMOS responde a esa fragmentación con un único recorrido funcional de extremo a extremo.”

---

## Diapositiva 4 - Solución funcional: un recorrido completo para tres tipos de usuario

### Texto visible

**Investigador**

- Crea workspaces aislados.
- Sincroniza REMMAQ o carga datasets propios.
- Limpia, explora y compara datos.
- Ejecuta modelos y exporta resultados.

**Administrador**

- Gestiona usuarios, roles y configuración.
- Supervisa la operación y los límites de cómputo.

**Ciudadanía**

- Consulta el mapa y los indicadores sin autenticación.
- Visualiza cobertura, frescura y ayudas interpretativas.

### Guion oral

“La solución integra tres experiencias sobre una misma base de datos. El investigador dispone de espacios de trabajo independientes donde incorpora datos, configura análisis y conserva resultados. El administrador controla usuarios, roles y parámetros operativos. El usuario público accede sin autenticación a un tablero comprensible. Funcionalmente, la plataforma cubre ingesta automática desde REMMAQ, carga manual desde archivo o URL, tratamiento de datos faltantes, dieciséis tipos de análisis exploratorio, modelos estadísticos ARIMA, SARIMA y Prophet, y modelos de aprendizaje profundo LSTM, GRU y Transformer.”

### Recurso visual

Usar tres tarjetas de rol conectadas a un flujo central:

**REMMAQ/dataset → ETL → workspace → EDA → modelos → visualización/exportación**

Como apoyo visual se pueden utilizar las Figuras 60 a 64 del documento (pp. 287-290).

### Mensaje funcional clave

ATMOS no es únicamente un dashboard ni únicamente un módulo de machine learning. Es una plataforma que conecta todo el ciclo de trabajo y conserva la procedencia del dato.

### Transición

“Para sostener este flujo sin mezclar responsabilidades, se tomó una decisión arquitectónica deliberada.”

---

## Diapositiva 5 - Arquitectura: cliente-servidor desacoplado con backend monolítico modular

### Texto visible

**Clasificación correcta**

ATMOS utiliza una arquitectura **cliente-servidor desacoplada**. El frontend y el backend se despliegan por separado, pero el backend es un **monolito modular por capas**, no un conjunto de microservicios.

**Frontend SPA**

React 18 + TypeScript + Vite · React Context · Radix UI · Plotly.js · Leaflet

**Backend API**

FastAPI + Python 3.11 + Uvicorn · REST `/api/v1` · Pydantic · SQLAlchemy · 11 routers y servicios de dominio

**Persistencia y externos**

PostgreSQL 16 · almacenamiento de archivos · REMMAQ · Azure Communication Services

### Guion oral

“Arquitectónicamente, ATMOS no es un sistema de microservicios. Es un cliente-servidor desacoplado: una SPA en React consume una API REST versionada en FastAPI y ambas unidades pueden desplegarse de forma independiente. Sin embargo, la lógica del backend vive en una sola aplicación desplegable. Internamente se organiza como monolito modular en cinco capas: configuración, enrutamiento y dependencias, routers por dominio, servicios de negocio y persistencia. Esto ofrece cohesión, pruebas aislables y menor costo operativo. En el alcance actual, separar cada módulo como microservicio habría añadido redes, observabilidad y coordinación distribuida sin una carga que lo justificara.”

### Esquema visual simplificado

```text
Usuarios
   │
   ▼
React SPA ──HTTPS/REST + JWT──► FastAPI modular
                                  ├─ autenticación y usuarios
                                  ├─ workspaces
                                  ├─ ETL y datasets
                                  ├─ EDA y analítica avanzada
                                  ├─ experimentos ML
                                  └─ tablero público
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
                 PostgreSQL         File Storage        REMMAQ / ACS
```

### Respuesta corta si el jurado pregunta “¿monolito o microservicios?”

“Es un monolito modular en el backend, dentro de una arquitectura cliente-servidor desacoplada. La SPA y la API son contenedores independientes, pero los dominios del backend todavía comparten proceso y base de código. Los límites modulares permiten extraer servicios en el futuro si la carga lo exige.”

### Recurso visual

Redibujar la Figura 32 (p. 125) con menos elementos. No insertar la figura completa tal como aparece en la memoria porque sus etiquetas serán ilegibles en una exposición.

### Transición

“Dentro de esa arquitectura, el flujo de datos y los trabajos de cómputo tienen tratamientos distintos.”

---

## Diapositiva 6 - Flujo técnico: trazabilidad desde la fuente hasta el modelo

### Texto visible

**Ingesta y calidad**

Descubrimiento HTML → descarga → descompresión → normalización de 14 variables → validación → carga por lotes → auditoría.

**Analítica**

16 tipos de análisis exploratorio + ARIMA, SARIMA y Prophet.

**Aprendizaje automático asíncrono**

LSTM, GRU y Transformer mediante un worker interno y estado persistente en PostgreSQL.

### Guion oral

“La ingesta automática descubre los archivos publicados por REMMAQ, los descarga y descomprime, identifica alias para catorce variables y normaliza estructuras largas y anchas antes de cargar los registros. Cada fuente conserva checksum, estado y trazabilidad. Para datasets propios, el sistema perfila columnas y ofrece imputación KNN para variables numéricas y moda para categóricas, siempre creando una copia derivada sin sobrescribir el original. Los entrenamientos se ejecutan en segundo plano. PostgreSQL funciona como cola persistente: el experimento se registra como pendiente, un worker lo reclama de forma atómica y lo ejecuta en un hilo separado. El patrón Registry/Strategy permite agregar nuevos algoritmos sin modificar el orquestador.”

### Explicación técnica precisa

- No existe Redis, RabbitMQ ni Celery en la versión actual.
- El worker consulta la tabla de experimentos aproximadamente cada dos segundos.
- `claimed_at` y `claimed_by` evitan que dos workers reclamen el mismo trabajo.
- El entrenamiento usa un `ThreadPoolExecutor` de un hilo para no bloquear el ciclo HTTP.
- Una rutina de reconciliación marca como fallidos los trabajos interrumpidos tras un reinicio.

### Mensaje de diseño

La solución favorece simplicidad operativa y reproducibilidad para la escala académica actual; no pretende todavía procesamiento distribuido de alto volumen.

### Recurso visual

Diagrama de flujo con dos rutas después de persistir:

- ruta interactiva: **consulta → análisis → gráfico**;
- ruta asíncrona: **experimento pendiente → worker → modelo/métricas**.

### Fuente en el documento

Arquitectura del backend: pp. 128-130. Resultados funcionales: pp. 286-290.

### Transición

“La separación funcional se complementa con controles de acceso, aislamiento de proyectos y servicios administrados en la nube.”

---

## Diapositiva 7 - Seguridad, datos y despliegue

### Texto visible

**Seguridad**

JWT firmado · refresh tokens de un solo uso · bcrypt · RBAC · verificación de correo institucional.

**Aislamiento y trazabilidad**

Un esquema PostgreSQL por workspace · checksums SHA-256 · archivos originales inmutables · migraciones Alembic.

**Azure y entrega continua**

Container Apps · Static Website · PostgreSQL Flexible Server · Communication Services · GitLab CI/CD.

### Guion oral

“El acceso privado se protege con JWT y control por roles para administrador, investigador y usuario genérico. Los refresh tokens se almacenan como hashes y se usan una sola vez; las contraseñas se protegen con SHA-256 previo y bcrypt. Cada workspace recibe un esquema propio en PostgreSQL y un directorio de almacenamiento asociado, reduciendo la contaminación cruzada entre proyectos. Los datos transaccionales permanecen en PostgreSQL y los archivos crudos, derivados en Parquet y artefactos de modelos se conservan en almacenamiento persistente. El backend se despliega en Azure Container Apps, el frontend como sitio estático y la base en Azure PostgreSQL. GitLab solo despliega desde main cuando todas las compuertas están aprobadas.”

### Aclaración sobre PostGIS

PostGIS está instalado y disponible, pero la versión final almacena latitud y longitud como campos numéricos y realiza la visualización con Leaflet en el cliente. No afirmar que ya existen consultas espaciales avanzadas en la base de datos; ese aprovechamiento queda como trabajo futuro.

### Transición

“Estas decisiones no se evaluaron únicamente por inspección: el proyecto dejó evidencia automatizada y aceptación funcional.”

---

## Diapositiva 8 - Resultados: cobertura funcional y calidad verificable

### Texto visible

**Producto implementado**

- 69 operaciones REST en 11 routers.
- Flujo completo desde REMMAQ o archivo propio hasta análisis, modelos y exportación.
- 45 historias de usuario aceptadas por el patrocinador.

**Calidad automatizada**

- **230/230 pruebas aprobadas**.
- Backend: 223 pruebas, 82,62 % de cobertura.
- Frontend: 7 pruebas, 100 % sobre la lógica evaluada.
- Pylint 10/10; Ruff, ESLint y TypeScript sin hallazgos.

### Guion oral

“Al cierre del octavo sprint, la plataforma quedó operativa en Azure y completó todos los módulos comprometidos. Expone 69 operaciones REST distribuidas en once routers. La corrida final del pipeline ejecutó 230 pruebas: 214 unitarias y nueve de integración en el backend, más siete en el frontend, todas aprobadas. El backend alcanzó 82,62 por ciento de cobertura frente a un umbral de 80 por ciento; Pylint obtuvo 10 sobre 10 y las demás compuertas no reportaron errores. Además, las 45 historias de usuario fueron revisadas y aprobadas por el patrocinador el 11 de julio de 2026. Las pruebas también detectaron tres defectos de severidad alta —redirecciones en REMMAQ, dependencia de red dentro del request público y caída de arranque ante errores de base de datos—, todos corregidos con pruebas de regresión.”

### Qué significa funcionalmente

- El dashboard público responde desde una instantánea persistida y no depende de una llamada a REMMAQ durante cada consulta.
- Los procesos largos no congelan la interfaz.
- Los flujos de autenticación, aislamiento, ETL, analítica y ML tienen trazabilidad requisito-prueba-evidencia.

### Qué no significa

Las pruebas demuestran una base estable, pero no autorizan a decir que el sistema está listo para producción crítica. Aún faltan pruebas formales de carga, concurrencia, recuperación, accesibilidad y una cobertura más amplia de recorridos del frontend.

### Impacto esperado, no medido

La memoria estima que el flujo futuro podría reducir un estudio típico de **160-320 horas a 15-30 horas**, equivalente a una mejora proyectada de **90-94 %**. Presentar esta cifra como estimación del proceso TO-BE, no como resultado de un experimento con usuarios.

### Recurso visual

Usar la Figura 53 del documento (p. 281) o recrear cuatro indicadores grandes: **230/230**, **82,62 %**, **45 HU**, **69 endpoints**.

### Transición

“La evaluación también permitió identificar con claridad qué funciona hoy y qué debe evolucionar antes de una adopción mayor.”

---

## Diapositiva 9 - Limitaciones y trabajo futuro priorizado

### Texto visible

**1. Robustez productiva**

Pruebas de carga, concurrencia, accesibilidad y recuperación; monitoreo, respaldos verificados y proxy institucional.

**2. Escalamiento analítico**

Separar el worker del API, introducir una cola distribuida y permitir múltiples réplicas y mini-lotes.

**3. Calidad científica**

Optimización de hiperparámetros, validación temporal, nuevas familias de modelos y comunicación explícita de cobertura e incertidumbre.

**4. Expansión ambiental**

Nuevas fuentes, sensores IoT, PostGIS real, análisis espacial, alertas y experiencia móvil accesible.

### Guion oral

“La principal limitación operativa es que la configuración desplegada utiliza una sola réplica. El API, la sincronización y el entrenamiento compiten por dos vCPU, y un reinicio interrumpe trabajos en curso. Los modelos profundos actuales sirven para comparación exploratoria, no para máxima precisión: trabajan con capacidad fija y entrenamiento por lote completo; algunos experimentos obtuvieron R² negativo, demostrando que terminar un entrenamiento no equivale a producir una predicción útil. También existe dependencia directa de una fuente externa heterogénea y sin contrato de servicio. Por ello, los siguientes pasos son separar el worker, incorporar colas y observabilidad, fortalecer validación científica, explotar realmente PostGIS e integrar nuevas fuentes o sensores.”

### Prioridad recomendada

1. **Primero:** confiabilidad, seguridad, monitoreo y validación con usuarios.
2. **Después:** worker distribuido, varias réplicas y pruebas de rendimiento.
3. **Luego:** hiperparámetros, nuevos modelos, fuentes, análisis espacial y alertas.

### Fuente en el documento

Debilidades: pp. 292-293. Recomendaciones: pp. 300-301. Trabajo futuro: pp. 302-303.

### Transición

“Con estas limitaciones explícitas, la contribución final puede expresarse con precisión y sin sobredimensionar el sistema.”

---

## Diapositiva 10 - Conclusiones

### Texto visible

**ATMOS integra el ciclo ambiental de extremo a extremo.**

**Convierte preparación manual en un proceso trazable y reutilizable.**

**Entrega valor distinto a investigadores, administradores y ciudadanía.**

**La base técnica está validada; la siguiente etapa es demostrar impacto y robustez operativa.**

### Guion oral

“ATMOS cumplió el propósito de integrar ingesta, preparación, análisis, monitoreo y experimentación en una sola plataforma. Su mayor aporte no es afirmar que un modelo predice perfectamente, sino organizar el proceso completo, conservar la procedencia del dato y hacer visibles su cobertura, calidad e incertidumbre. La arquitectura modular ofrece una base mantenible para crecer sin asumir prematuramente la complejidad de microservicios. El siguiente paso es validar el impacto con usuarios, fortalecer la operación y convertir esta base académica en una capacidad institucional sostenible.”

### Frase final

> ATMOS convierte datos ambientales dispersos en evidencia reproducible para investigar, comunicar y decidir mejor.

---

## Resumen técnico para preguntas del jurado

### ¿Es un monolito modular o microservicios?

Es un **backend monolítico modular por capas**, acompañado por una SPA independiente. Frontend y backend son unidades desplegables separadas, pero autenticación, ETL, analítica, workspaces y ML conviven dentro del mismo proceso FastAPI. No hay comunicación entre microservicios ni bases independientes por servicio.

### ¿Por qué no se eligieron microservicios?

Porque el volumen, el equipo, el plazo y el presupuesto no justificaban la complejidad de despliegue, red, observabilidad, consistencia distribuida y operación. El monolito modular conserva límites de dominio y permite extraer el worker o un servicio específico cuando exista evidencia de carga.

### ¿Qué se desacopló realmente?

- Presentación y negocio: React consume FastAPI únicamente por REST.
- Lógica HTTP y lógica de negocio: routers separados de servicios.
- Procesos largos y peticiones: el worker procesa experimentos en segundo plano.
- Datos transaccionales y archivos: PostgreSQL frente a almacenamiento persistente.
- Proveedor de correo y autenticación: un adaptador permite sustituir Azure Communication Services.

### ¿Cómo se manejan las bases de datos?

PostgreSQL 16 almacena usuarios, estaciones, variables, mediciones, ejecuciones ETL, workspaces y experimentos. Las entidades centrales siguen tercera forma normal, con desnormalización controlada en campos agregados de auditoría. Hay índices compuestos para consultas por estación, variable y rango temporal. Cada workspace recibe un esquema lógico propio; no se crea una instancia física de base de datos por proyecto.

### ¿Qué aporta PostGIS hoy?

La extensión está habilitada, pero no se aprovecha todavía mediante columnas geométricas ni consultas espaciales. Las coordenadas se almacenan como latitud y longitud, y Leaflet representa las estaciones en el frontend. El análisis geoespacial avanzado con PostGIS es trabajo futuro.

### ¿Cómo funciona la asincronía sin Redis?

El experimento se persiste como `pending` en PostgreSQL. Un worker dentro del proceso FastAPI sondea la tabla, reclama un trabajo atómicamente y entrena en un hilo separado. El enfoque funciona para baja concurrencia y reduce costo operativo, pero el paso futuro es externalizar el worker y usar una cola distribuida.

### ¿Cómo se evita perder trazabilidad?

Se conservan los archivos originales, se generan copias derivadas, se registran checksums SHA-256, estados de ingesta, conteos, origen del dato, configuraciones del análisis y resultados de experimentos. El código de entrenamiento se expone en modo lectura para facilitar auditoría metodológica.

### ¿Los modelos ya son aptos para alertas oficiales?

No. Son herramientas de exploración y comparación científica. Algunos resultados tuvieron R² bajo o negativo; además, la cobertura y calidad de la fuente condicionan los resultados. ATMOS no sustituye a la REMMAQ ni constituye un sistema regulatorio o crítico de alerta temprana.

### ¿Cuál es la evidencia de calidad?

La corrida final documentada ejecutó 230 pruebas con 100 % de aprobación: 223 en backend y siete en frontend. La cobertura del backend fue 82,62 % y las compuertas estáticas aprobaron sin hallazgos. También se aprobaron 45 historias de usuario. Esto demuestra una base estable y trazable, no preparación definitiva para producción crítica.

### ¿Cuál es el principal riesgo?

La dependencia de REMMAQ, que no ofrece API oficial ni garantías de disponibilidad, y la competencia de recursos en una única réplica. El tablero público mitiga el primer riesgo atendiendo consultas desde una instantánea persistida en lugar de consultar la fuente durante cada petición.

---

## Cifras que pueden mostrarse

| Cifra | Uso correcto |
|---:|---|
| 3 perfiles | Administrador, investigador y usuario genérico/público. |
| 14 variables REMMAQ | Variables reconocidas y normalizadas por el pipeline. |
| 16 tipos de análisis | Capacidades del espacio exploratorio. |
| 3 modelos estadísticos | ARIMA, SARIMA y Prophet. |
| 3 modelos profundos | LSTM, GRU y Transformer. |
| 69 operaciones REST | Superficie de la API final. |
| 11 routers | Organización funcional de la API. |
| 230 pruebas | 223 backend + 7 frontend, todas aprobadas en la corrida documentada. |
| 82,62 % | Cobertura del backend frente a umbral de 80 %. |
| 45 historias de usuario | Aceptadas por el patrocinador el 11 de julio de 2026. |
| 160-320 h → 15-30 h | Estimación AS-IS/TO-BE; no es un resultado experimental. |

---

## Advertencias para mantener rigor durante la defensa

1. No decir que ATMOS es una arquitectura de microservicios.
2. No decir que PostGIS ya ejecuta análisis espacial avanzado; está habilitado, pero no explotado.
3. No afirmar que el sistema está listo para producción crítica.
4. No presentar el 90-94 % de ahorro como medición validada; es una estimación del proceso futuro.
5. No presentar los modelos como predictores certificados ni como base para alertas oficiales.
6. Diferenciar medición real de superficie estimada en cualquier mapa interpolado.
7. No afirmar que existe ingesta en tiempo real; el procesamiento actual es periódico y por lotes.
8. Evitar cifras de costo en la exposición: el documento contiene valores comparativos que no son consistentes entre secciones.
9. Unificar antes de diseñar la portada el significado extendido del acrónimo ATMOS, porque el documento emplea más de una expansión.

### Inconsistencia que debe resolverse antes de mostrar el mapa

La sección de resultados (p. 285) menciona una superficie IDW, mientras que la discusión ética (p. 296) afirma que no se implementa interpolación espacial. Antes de la defensa, verificar la versión desplegada:

- si existe IDW, presentarlo como **superficie estimada**, nunca como medición fuera de las estaciones, y mantener una advertencia visible;
- si no existe, eliminar de la presentación toda referencia a interpolación.

---

## Recomendaciones de diseño visual

- Formato 16:9 y máximo una idea principal por diapositiva.
- Títulos de 32-38 pt; cuerpo de 20-24 pt; cifras principales de 36-48 pt.
- Mantener entre tres y cinco elementos visibles por diapositiva.
- Usar capturas reales del sistema y evitar prototipos cuando exista una pantalla implementada.
- Redibujar la arquitectura con seis o siete bloques; el diagrama C4 completo es evidencia documental, no una diapositiva legible.
- Usar un solo color para problema, otro para solución y un tercero para evidencia.
- En resultados, privilegiar cuatro KPIs grandes y explicar los detalles oralmente.
- Incluir en un pie discreto la fuente: “Documento final, pp. X-Y”.

## Apertura y cierre memorizables

### Apertura

“En Quito sí existen datos de calidad del aire. Lo que faltaba era un proceso integrado para convertirlos en conocimiento reproducible. ATMOS fue diseñado para cerrar esa brecha.”

### Cierre

“La principal contribución de ATMOS no es una predicción aislada, sino una capacidad institucional: pasar de datos dispersos a evidencia trazable para investigar, comunicar y decidir mejor.”
