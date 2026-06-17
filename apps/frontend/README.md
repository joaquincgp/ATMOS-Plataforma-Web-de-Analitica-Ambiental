# ATMOS Frontend

SPA de ATMOS construida con React 18, TypeScript y Vite.

## Requisitos

- Node.js 18+.
- npm.
- Backend disponible en `http://localhost:8000` o una URL configurada.

## Configuración Local

Desde la raíz del repositorio:

```bash
cp apps/frontend/.env.example apps/frontend/.env.local
```

Variable principal:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Ejecución

Desde la raíz:

```bash
npm install
npm run dev:frontend
```

O desde `apps/frontend`:

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://localhost:5173`.

## Ejecución Con Docker

Desde la raíz, junto con backend y base de datos:

```bash
docker compose up --build
```

El contenedor compila la SPA con Vite y la sirve con Nginx en `http://localhost:5173`.

## Comandos

Desde la raíz:

```bash
npm run dev:frontend
npm run build:frontend
npm run lint:frontend
npm run typecheck:frontend
npm run test:frontend
npm run coverage:frontend
```

Desde `apps/frontend`:

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
npm run test
```

## Estructura

```text
src/
  app/                    # shell principal de la aplicación
  api/                    # clientes HTTP
  components/             # layout y UI reutilizable
  features/               # módulos por dominio
  hooks/                  # hooks compartidos
  store/                  # estado global
  shared/                 # configuración, tipos y utilidades
  styles/                 # estilos globales
```

## Notas

- Vite lee variables que empiezan con `VITE_`.
- Si cambias `VITE_API_BASE_URL`, reinicia el servidor de desarrollo.
- En Docker, `VITE_API_BASE_URL` se define durante el build de la imagen del frontend.
