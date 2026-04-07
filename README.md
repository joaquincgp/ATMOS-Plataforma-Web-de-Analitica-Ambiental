# ATMOS (Analytics Time-Series Modeling Operational System)

ATMOS es una plataforma web diseñada para la ingestión, transformación (ETL), analítica, monitoreo y predicción de calidad de aire basada en series temporales. El sistema está orientado a la gestión de áreas de investigación (workspaces) completamente aisladas, permitiendo que distintos equipos o proyectos analicen datos ambientales de forma independiente, reproducible y segura. 

La plataforma aprovecha los datos públicos recopilados por la REMMAQ (Red Metropolitana de Monitoreo de Calidad del Aire), gracias a su red de sensores, para visibilizar, interpretar y comunicar el estado de la calidad del aire en la ciudad de Quito, mediante visualizaciones interactivas y modelos predictivos.

##  Características Principales
- **ETL Robusto:** Ingestión de series temporales históricas y soporte para cargas de datos manuales.
- **Analytical Workspace:** Entornos interactivos de análisis con visualizaciones de datos y gráficos dinámicos.
- **Autenticación y RBAC:** Seguridad basada en JSON Web Tokens (JWT) con control de acceso basado en roles (`admin`, `researcher`, `generic`).
- **Arquitectura Multi-tenant:** Aislamiento de datos a nivel de base de datos utilizando un esquema de PostgreSQL por cada tenant/workspace (`schema-per-tenant`).
- **Persistencia de Dashboards:** Guardado de dashboards personalizados por workspace con soporte para bloques de visualización dinámicos.

## Stack Tecnológico
El proyecto está estructurado como un monorepo que divide claramente las responsabilidades del cliente y del servidor:

**Backend:**
- **[FastAPI](https://fastapi.tiangolo.com/):** Framework web de alto rendimiento para construir APIs con Python 3.11+.
- **SQLAlchemy (v2) & Alembic:** ORM y sistema de migraciones para la gestión fluida de base de datos.
- **PostgreSQL & PostGIS:** Motor de base de datos relacional con extensión geoespacial para datos atmosféricos y de ubicación.
- **Pydantic:** Validación estricta de datos y gestión de configuraciones (settings).
- **Pandas & Beautifulsoup4:** Utilizados intensivamente en pipelines ETL para procesamiento matemático y extracción de datos web.

**Frontend:**
- **React 18 & TypeScript:** Core del cliente para la construcción de interfaces seguras e interactivas.
- **Vite:** Herramienta de compilación ultrarrápida (HMR) e inicialización del proyecto.
- **Tailwind CSS & Radix UI / MUI:** Sistemas de diseño y utilidades CSS pragmáticas para estilado responsivo y componentes accesibles de alto nivel.
- **Recharts:** Librería de gráficos composables enfocada en la visualización clara de series temporales.
- **React Leaflet:** Integración con mapas interactivos para información geoespacial.

## 📁 Estructura del Proyecto
```text
ATMOS/
├── apps/
│   ├── backend/       # API RESTful en FastAPI, servicios ETL, modelos de BD
│   └── frontend/      # SPA interactiva en React + Vite + Tailwind CSS
├── docs/              # Documentación técnica, diseño y manuales
├── infra/             # Configuraciones de infraestructura y despliegue 
├── packages/          # Módulos y dependencias compartidas (ej. contracts comunes)
├── docker-compose.yml # Orquestación de contenedores para desarrollo local unificado
└── package.json       # Funciones y scripts globales de NPM Workspace
```

## Variables de Entorno (Configuración)
Para configurar la API, debes copiar el archivo de ejemplo en el backend (ubicado en `apps/backend/.env.example`) a `apps/backend/.env` y ajustar las variables según necesites:

- `DATABASE_URL`: Cadena de conexión principal para PostgreSQL (ej. `postgresql+psycopg://atmos:password@localhost:5432/atmos`).
- `JWT_SECRET_KEY`: Clave secreta para firmar los tokens JWT. **Debe cambiarse para entornos de producción.**
- `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`: Configuración de la duración y vigencia de la sesión de usuario.
- `AUTO_INIT_DB_ON_STARTUP`: Al asiganarle `true`, el esquema base se inicializará automáticamente en la base de datos de PostgreSQL.
- `WORKSPACE_STORAGE_DIR`: Directorio en disco donde se persistirán archivos y artefactos de los workspaces (por defecto: `./data/workspaces`).
- `CORS_ORIGINS`: URLs permitidas para solicitudes en el ambiente web (por defecto en local: `http://localhost:5173`).

## Instalación y Formas de Ejecución

Existen dos vías principales para correr la plataforma de manera local: corriendo contenedores con Docker/Docker Compose (muy recomendado para un arranque sin fricciones) o ejecutando los procesos por su cuenta en el entorno host.

### Opción 1: Docker Compose
Requisitos previos: `Docker` y `Docker Compose` corriendo.
Esta es la ruta más rápida. Inicializa contenedores para PostGIS, el servidor FastAPI (backend) y el entorno en caliente de Vite (frontend) sin configurar intérpretes locales.

1. Instala las dependencias base a nivel raíz para tener control de los scripts:
   ```bash
   npm install
   ```
2. Ejecuta todo el conjunto mediante el comando de npm:
   ```bash
   npm run dev
   ```
   *Esto internamente orquestará `docker compose up --build` levantando los servicios enlazados y conectados por redes locales de bridge en Docker.*

**Acceso a los Servicios:**
- Aplicación Frontend SPA: `http://localhost:5173`
- Backend API Principal: `http://localhost:8000`
- Documentación OpenAPI Explicativa (Swagger UI): `http://localhost:8000/docs`

### Opción 2: Ejecución Local Independiente
Ideal para depuración pura en editores como VSCode, PyCharm u otros donde quieres utilizar los "debuggers" integrados del backend. Es necesario tener Node.js 18+, Python 3.11+, e idealmente una base de datos de Postgres levantada.

1. **Base de Datos (PostgreSQL):**
   Aún podrías usar Docker exclusivamente para levantar tu BD y no instalar Postgis manualmente:
   ```bash
   docker compose up db -d
   ```
2. **Setup y Run del Backend:**
   Entra a la carpeta de aplicación, crea tu entorno virtual y ejecuta Uvicorn:
   ```bash
   cd apps/backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[dev]"
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
3. **Setup y Run del Frontend:**
   En otra terminal, corre solo el servidor de cliente desde la base de tu mono-repo:
   ```bash
   npm install
   npm run dev:frontend
   ```

### Opcion 3: Acceso por Red Local (LAN)

Permite que otros equipos en la misma red (Wi-Fi o Ethernet) accedan a la aplicacion sin configuracion adicional. Probar la plataforma desde otros dispositivos mientras el servidor corre en una sola maquina.

Requisitos previos: Node.js 18+, Python 3.11+ y PostgreSQL corriendo (puedes usar `make db-up`).

```bash
make dev-lan
```

El comando detecta automaticamente la IP local de la maquina, configura el CORS del backend y la URL del frontend, y levanta ambos servidores.

Para detener los servidores usa `Ctrl+C`. 
O para hacerlo manualmente, usa:

```bash
make lan-stop
```

Para limpiar los archivos de configuracion generados:

```bash
make lan-clean
```

> **Nota:** Los archivos generados (`apps/backend/.env` y `apps/frontend/.env.local`) estan excluidos en `.gitignore` y no se subiran al repositorio.

## Scripts Disponibles con NPM Workspaces
El archivo `package.json` raíz simplifica la inicialización orquestando las acciones frecuentas para los desarrolladores. Desde el directorio base del proyecto (`ATMOS/`) puedes usar:

- `npm run dev`: Inicia todo el orquestador backend, frontend, y BD en sus contenedores respectivos de Docker.
- `npm run dev:frontend`: Levanta sólo el servidor dev de Vite para el frontend en `0.0.0.0:5173`.
- `npm run build:frontend`: Fuerza la compilación (build) y empaquetado de React + TypeScript para entornos de producción.
- `npm run lint:frontend`: Analiza y avisa de reglas de código erróneas usando ESLint en el frontend.
- `npm run typecheck:frontend`: Lanza el sistema de tipos de TypeScript sin modificar ni emitir archivos JS puros para encontrar errores estrictos.
- `npm run backend:dev`: Ingresa a la carpeta de API y levanta Uvicorn auto-recargable en el puerto 8000.
- `npm run backend:test`: Busca y corre pruebas de verificación unitarias empleando `pytest` en la carpeta backend.
- `npm run backend:lint`: Ejecuta el analizador sintáctico `ruff` en el Python de la API para garantizar el formato del código.

## Flujo Básico de Uso
1. **Puesta a Punto de DB:** Arranca el servidor (idealmente con `AUTO_INIT_DB_ON_STARTUP=true`). Esto sembrará las tablas y esquemas indispensables eliminando la necesidad de migraciones previas.
2. **Acceso y Registro Inicial:** Accede a `http://localhost:5173`, regístrate usando la página de inicio como un nuevo usuario. Por lo general asimilarás un rol de `researcher` o `generic` lo que condiciona tu acceso.
3. **Página de Workspaces:** Creada tu sesión, entra a la zona de Workspaces. Si el rol que posees lo permite, podrás crear uno. Al nombrarlo y configurarlo, el backend actuará de orquestador creando inmediatamente en la BD el esquema individualizado dedicado (ej. `ws_joaquin_clima_1`).
4. **Análisis Continuo:** Ingresa dentro del workspace donde podrás administrar fuentes ETL, importar datos de CSVs/Excel, procesar información de API externas, y graficar resultados montando un Dashboard propio que será almacenado de manera continua y persistente bajo ese contexto virtual.

## Contribución
¡Las contribuciones y Pull Requests son siempre bienvenidos! Por favor, asegúrate de revisar nuestra [Guía de Contribución](CONTRIBUTING.md) para conocer los estándares del proyecto y el ciclo de desarrollo recomendado.

## Licencia
Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.
