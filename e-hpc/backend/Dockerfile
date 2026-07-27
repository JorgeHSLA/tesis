# backend/Dockerfile — architecture.md §10.1.
# DECISIÓN EXPLÍCITA (riesgo aceptado y documentado): el proceso corre como
# root DENTRO del contenedor — un backend no-root no podría abrir
# /var/run/docker.sock (gid del host, variable entre máquinas) sin group_add
# configurable. El aislamiento real es el módulo único docker_service (§5),
# el bind a loopback y el sandbox del runner.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

# Nivel 3 (seguridad por AUSENCIA): DOS imágenes desde UN codebase, como el
# tree-shaking del frontend.
#   EHPC_ADMIN_BUILD=0 (default, ESTUDIANTE) → se BORRAN del artefacto los
#     módulos admin-only (router /admin, sus deps y el motor de escritura de
#     contenido). main.py detecta la ausencia (ModuleNotFoundError) y NO registra
#     el router → /api/v1/admin/* responde 404. Cero código admin en la imagen.
#   EHPC_ADMIN_BUILD=1 (ADMIN) → se conservan; el runtime los sigue gateando con
#     EHPC_ADMIN_MODE (variante de despliegue, api-contract.md §10.0).
# NOTA: app/repositories/content_admin.py NO se borra: lo importa el módulo
# NO-admin app/services/quiz_service.py (lee umbral e ids del quiz para la
# revalidación atómica del intento, api-contract §5.2). Borrarlo rompería el
# build estudiante (son helpers inertes: sin endpoints ni orquestación de escritura).
ARG EHPC_ADMIN_BUILD=0
RUN if [ "$EHPC_ADMIN_BUILD" != "1" ]; then \
      rm -f app/routers/admin.py app/routers/admin_deps.py \
            app/services/content_writer.py app/services/markdown_validator.py ; \
    fi

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
