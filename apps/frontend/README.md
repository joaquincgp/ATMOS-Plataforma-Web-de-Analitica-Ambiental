# ATMOS Frontend

Frontend SPA de ATMOS (React + TypeScript + Vite).

## Estructura base

```text
src/
  app/                    # shell principal de aplicacion
  api/                    # clientes HTTP y modulos de API
  components/             # layout + ui atomico/reutilizable
  features/               # modulos por dominio funcional
  hooks/                  # hooks de consumo y estado derivado
  store/                  # estado global (context)
  shared/                 # config compartida
  styles/                 # estilos globales
```

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Variables de entorno

Crear `.env` local desde `.env.example`:

```env
VITE_API_BASE_URL=http://localhost:8000
```
