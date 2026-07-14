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

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
