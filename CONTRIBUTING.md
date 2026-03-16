# Guía de Contribución

¡Gracias por tu interés en contribuir a ATMOS! Por favor, revisa esta guía para comprender nuestro flujo de trabajo y estándares en el proyecto.

## Requisitos previos
- Node.js 18+ y npm instalados.
- Familiaridad con React 18 + TypeScript y Tailwind CSS (Frontend) y Python FastAPI (Backend).
- Git configurado y una cuenta activa en GitHub.

## Flujo para contribuir
1. Haz un fork del repositorio y clónalo en tu entorno local.
2. Crea una rama descriptiva a partir de la predeterminada:
   ```bash
   git checkout -b feature/nombre-corto
   # o bien para un arreglo:
   git checkout -b fix/bug-descripcion
   ```
3. Copia `.env.example` a `.env` (revisa el backend y la raíz) y ajusta configuraciones como `VITE_API_BASE_URL` o la conexión a la base de datos al backend disponible para tu entorno de desarrollo.
4. Arranca el proyecto usando Docker (por ejemplo con `npm run dev`) y verifica tu cambio en el navegador u OpenAPI.
5. Ejecuta las validaciones y el build antes de abrir el PR para asegurar la calidad:
   ```bash
   npm run build:frontend
   npm run lint:frontend
   npm run backend:lint
   ```
6. Usa la convención semántica de commits:
   - `feat`: nueva funcionalidad
   - `fix`: corrección de bug
   - `chore`: tareas de soporte
   - `docs`: documentación
   - `refactor`: cambios internos sin afectar comportamiento
   - `test`: adición/mejora de pruebas
7. Abre un Pull Request describiendo tu cambio claramente  y enlaza el Issue correspondiente que aborda (si existiera).

## Estándares del proyecto
- Mantén el estándar y tipa los datos usando TypeScript (frontend) o Pydantic (backend); evita usar `any` sin justificación.
- Componentiza la UI de React de forma escalar y reutiliza estilos o tokens definidos con utilidades en base a Tailwind CSS y Radix/MUI en `src/styles` o similares.
- Mantén servicios de API debidamente seccionados y el estado global ordenado a través de los Context Providers del cliente.
- Nunca subas secretos o credenciales directamente a las plantillas `.env.example`; úsalo solo como registro de llaves referenciales.

## Dudas o soporte
Usa los Issues de GitHub para reportar errores puntuales o proponer mejoras planificadas. Para dudas rápidas relacionadas a código, comenta en el Pull Request.
