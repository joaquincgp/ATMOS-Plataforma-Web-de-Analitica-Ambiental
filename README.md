# ATMOS (Analytics Time-Series Modeling Operational System)

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_PostGIS-336791?logo=postgresql&logoColor=white)
![Machine Learning](https://img.shields.io/badge/Machine_Learning-LSTM_%7C_Prophet-FF6F00)

**ATMOS** es una plataforma web de inteligencia ambiental de arquitectura modular y desacoplada, diseñada para la gestión integral de datos espaciotemporales. El sistema centraliza la ingesta automatizada mediante pipelines ETL, el análisis exploratorio y la predicción de fenómenos atmosféricos utilizando modelos avanzados de Machine Learning.

Actualmente, ATMOS utiliza la red de monitoreo REMMAQ (Quito, Ecuador) como entorno de validación funcional, pero su diseño agnóstico permite su escalabilidad a diversos contextos de investigación ambiental.

---

## Características Principales

* **Pipeline ETL Robusto:** Módulo backend capaz de descargar, extraer (RAR/XLSX), transformar (Wide-to-Long) y cargar millones de registros históricos en lotes (*chunking*) de manera eficiente.
* **Workspaces de Investigación:** Aislamiento lógico de proyectos mediante un esquema Multi-Tenant, garantizando que los investigadores administren sus *datasets*, modelos y visualizaciones de forma privada.
* **Almacenamiento Geoespacial:** Integración nativa con PostGIS para consultas espaciales complejas (ubicación de estaciones, cruce de variables por radio geográfico).
* **Laboratorio ML Integrado:** Entrenamiento, validación y persistencia de modelos predictivos de series temporales (Random Forest, XGBoost, LSTM, Prophet) con métricas de evaluación en tiempo real (RMSE, MAE).
* **Consciencia Situacional (Map-First):** Dashboard público con renderizado geoespacial interactivo para la interpretación de la calidad del aire orientada a la ciudadanía.
* **Seguridad y API Contract:** Autenticación *stateless* mediante JWT y control de acceso basado en roles (RBAC).

---

## 🛠️ Stack Tecnológico

### Backend (Data & ML Services)
* **Framework:** FastAPI (Python 3.11+)
* **Procesamiento de Datos:** Pandas, NumPy, GeoPandas.
* **Inteligencia Artificial:** Scikit-Learn, Statsmodels, TensorFlow (Keras).
* **ORM & Base de Datos:** SQLAlchemy, PostgreSQL + extensión PostGIS.

### Frontend (SPA & Visualization)
* **Framework:** React con TypeScript.
* **Visualización de Datos:** Recharts / Chart.js.
* **Mapas:** Leaflet / React-Leaflet.
* **Estado:** React Context API / Zustand.

---

## Arquitectura 

La solución está desarrollada bajo una arquitectura de microservicios lógica (monolitos modulares desacoplados), con una separación estricta entre la presentación (Frontend SPA) y los servicios de datos (Backend REST API). 

El backend actúa mediante un esquema de **API Contract**, donde el motor de análisis solo acepta configuraciones estructuradas, garantizando validación estricta antes de la ejecución de algoritmos computacionalmente costosos.

---

## ⚙️ Instalación y Configuración Local

### Prerrequisitos
* Python 3.11 o superior.
* Node.js 18.x o superior.
* PostgreSQL 14+ con la extensión `postgis` habilitada.

### 1. Configuración del Backend (API)
```bash
# Navegar al directorio del backend
cd apps/backend

# Crear y activar entorno virtual
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Inicializar Base de Datos y correr ETL base
python init_db.py

# Iniciar el servidor local
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

## Arranque rapido

### Opcion A: stack completo con Docker

```bash
npm run dev
```

Servicios:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Docs OpenAPI: `http://localhost:8000/docs`

### Opcion B: frontend y backend por separado

Frontend:

```bash
npm install --workspace @atmos/frontend
npm run dev:frontend
```

Backend:

```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Calidad y checks

Frontend:

```bash
npm run lint:frontend
npm run typecheck:frontend
npm run build:frontend
```

Backend:

```bash
npm run backend:lint
npm run backend:test
```

## Despliegue

- Guia general Azure App Service: `docs/deployment-azure.md`
- Contrato API inicial: `packages/contracts/openapi/atmos-api.v1.yaml`


