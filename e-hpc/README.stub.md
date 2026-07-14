# E-HPC (stub — el README definitivo lo escribe WP11)

Plataforma educativa para aprender OpenMP con PyOMP: lecciones, quizzes y
ejecución de código real en contenedores Docker efímeros y aislados.

Este archivo es un marcador de posición del paquete WP0 (scaffold). La
documentación completa (prerequisitos, regla ext4, tabla `EHPC_*`, targets de
`make`, riesgo del socket Docker, guía del instalador desktop y
troubleshooting) llega con WP11.

## Referencias

- Arquitectura y contratos congelados: `docs/architecture/`
- Estructura del monorepo: `docs/architecture/architecture.md` §9
- Targets de make: `Makefile` (encapsulan la regla ext4 de WSL2)

## Arranque rápido (dev, WSL2)

```bash
make build-runner    # imagen ehpc-runner (una vez, ~777 MB)
make dev-backend     # uvicorn :8000 (nativo WSL)
make dev-frontend    # Vite :5173
```
