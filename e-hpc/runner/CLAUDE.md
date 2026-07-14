# runner/ — imagen Docker que ejecuta código PyOMP no confiable

Imagen `python:3.12-slim` + `pyomp==0.5.1` (wheel cp312 verificado — sin conda). El backend la **instancia por job** montando solo el archivo del estudiante; NO es un servicio de compose (aparece en compose bajo `profiles: ["build"]` solo para construirse). Detalle en `../docs/research/pyomp-runner.md`.

## Construir / probar

```bash
docker build -t ehpc-runner:0.5.1 runner/    # incluye smoke test de OpenMP en el build (fail-fast); ~777MB
```

## Sandbox (código NO confiable — no relajar)

El backend (`app/services/docker_service.py`) lanza cada contenedor con: `network_mode=none`, usuario non-root (uid 10001), `cap_drop=ALL`, `no-new-privileges`, `read_only=True` + tmpfs `/tmp` (noexec), `mem_limit=memswap_limit` (sin swap), `pids_limit`, `init=True`, código montado `:ro` en `/work`. Timeout duro con `wait(timeout)` + `kill`. Output truncado ~256KB.

## Gotchas de PyOMP / medición

- **`OMP_NUM_THREADS` = `NUMBA_NUM_THREADS` = `--cpus`** siempre: libomp NO es cgroup-aware (si no, ve todos los cores del host).
- **`@njit(cache=True)` está roto con regiones OpenMP** en pyomp 0.5.1: no se hornea caché JIT. La latencia de compilación se maneja con UX (fases "compilando→ejecutando" por WebSocket), no con caché.
- La primera llamada compila (JIT) → **nunca usar el wall-time del contenedor como métrica de speedup**; solo los 6 ejemplos que auto-miden (con warm-up) dan tiempos fiables. 3 ejemplos (piSpmd, piSpmdCritical, transporteMonteCarlo) barren 1/2/4/8 hilos en una sola corrida.
- `sumaVectoresGPU` requiere GPU NVIDIA + gcc → **deshabilitado por defecto** en el simulador.
- `NUMBA_CACHE_DIR=/tmp/numba_cache` + `PYTHONUNBUFFERED=1` van en la imagen (rootfs read-only).
