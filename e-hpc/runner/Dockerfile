# e-hpc/runner/Dockerfile — runner PyOMP de Telar
# Literal de docs/research/pyomp-runner.md §4 (CONGELADO).
# Base: hay wheel cp312 manylinux_2_28 (glibc>=2.28); trixie trae glibc 2.41.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # defaults seguros; el backend los sobreescribe con -e segun --cpus
    OMP_NUM_THREADS=4 \
    NUMBA_NUM_THREADS=4 \
    # si el estudiante usa @njit(cache=True) sin openmp, que escriba en tmpfs
    NUMBA_CACHE_DIR=/tmp/numba_cache

# pin exacto: pyomp 0.5.1 resuelve numba 0.63.1 + llvmlite 0.46.0 + numpy 2.3.5
# compileall precompila .pyc de numba/llvmlite -> import ~0.2s mas rapido y
# se hornea en la capa de imagen (unica "cache" horneable; ver doc §5)
RUN pip install "pyomp==0.5.1" \
 && python -m compileall -q /usr/local/lib/python3.12/site-packages

# usuario non-root sin shell de login
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner

USER runner
WORKDIR /home/runner

# Smoke test EN EL BUILD: compila y ejecuta un hello openmp real.
# Valida wheel+libomp+pass LLVM (fail-fast si la imagen quedo rota).
# OJO: NO deja cache JIT reutilizable (cache=True no funciona con openmp, §5).
RUN printf '%s\n' \
      'from numba.openmp import njit, openmp_context as openmp' \
      'from numba.openmp import omp_get_num_threads' \
      '@njit' \
      'def smoke():' \
      '    n = 0' \
      '    with openmp("parallel"):' \
      '        with openmp("critical"):' \
      '            n += 1' \
      '    return n' \
      'assert smoke() >= 1' \
      'print("smoke test OpenMP OK")' > /tmp/smoke.py \
 && python /tmp/smoke.py && rm -f /tmp/smoke.py

# el backend monta el codigo del estudiante en /home/runner/main.py (read-only)
CMD ["python", "/home/runner/main.py"]
