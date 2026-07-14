"""Servicios del backend E-HPC (WP2).

- ``docker_service``: ÚNICO módulo del repo que importa ``docker``.
- ``job_runner``: orquestación del ciclo de vida del job (drainer, kill_reason).
- ``output_parser``: los 6 ``parser_id`` de architecture.md §7.2.

Las excepciones viven aquí para que ``job_runner`` pueda capturarlas sin
importar (ni transitivamente) el paquete ``docker``.
"""


class DockerServiceError(Exception):
    """Error genérico del servicio Docker (detalle SOLO en logs del servidor)."""


class RunnerTimeout(DockerServiceError):
    """``wait(timeout=N)`` excedió el tope wall-clock (ReadTimeout/ConnError)."""


class RunnerNotFound(DockerServiceError):
    """El contenedor ya no existe (carrera benigna en kill/remove)."""
