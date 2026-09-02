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
#   TELAR_ADMIN_BUILD=0 (default, ESTUDIANTE) → se BORRAN del artefacto los
#     ROUTERS admin y los servicios que solo ellos usan. main.py detecta la
#     ausencia (ImportError) y NO registra los routers → /api/v1/admin/*
#     responde 404: la ruta no existe, que es más fuerte que un 401.
#   TELAR_ADMIN_BUILD=1 (ADMIN) → se conservan; el runtime los sigue gateando con
#     TELAR_ADMIN_MODE (variante de despliegue, api-contract.md §10.0).
#
# Lo que se borra son las SUPERFICIES (routers) y lo que cuelga solo de ellas.
# Los helpers que también usa código del estudiante se QUEDAN, aunque su nombre
# suene a admin: sin router que los invoque son inertes.
#
# NO se borran, y borrarlos rompe el arranque del build estudiante:
#   repositories/content_admin.py  → lo usa services/quiz_service (§5.2).
#   services/markdown_validator.py → lo usa services/bundle_guard, que valida
#     los bundles que llegan DEL BUCKET en la máquina del estudiante (§11.6.1).
#   services/content_writer.py     → routers/catalog y module_installer importan
#     `_persist`, la unidad de escritura de toda incorporación (§11.6).
# Las dos últimas eran admin-only en Fase 4 y dejaron de serlo en Fase 5: el
# catálogo remoto puso al estudiante a validar y a escribir contenido.
ARG TELAR_ADMIN_BUILD=0
RUN if [ "$TELAR_ADMIN_BUILD" != "1" ]; then \
      rm -f app/routers/admin.py app/routers/admin_deps.py \
            app/routers/admin_catalog.py \
            app/services/catalog_publisher.py app/services/catalog_publish.py \
            app/services/catalog_import.py app/schemas/admin_catalog.py ; \
    fi

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
