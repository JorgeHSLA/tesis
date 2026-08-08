"""Configuración del backend Telar.

Tabla única de variables de entorno ``TELAR_*`` — TRANSCRIPCIÓN de
``docs/architecture/architecture.md`` §10.5 (CONGELADA). ``TELAR_COMPOSE_DIR``
no aparece aquí: es exclusiva del shell de escritorio (electron-spec §5.3).
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings leídos del entorno con prefijo ``TELAR_``."""

    model_config = SettingsConfigDict(env_prefix="TELAR_", extra="ignore")

    # Persistencia (db.py)
    db_path: str = "~/.telar/telar.db"  # compose: /app/data/telar.db

    # CORS + validación Origin del WS
    allowed_origins: str = (
        "http://localhost:5173,http://localhost:8080,"
        "http://127.0.0.1:5173,http://127.0.0.1:8080,null"
    )

    # docker_service
    code_delivery: Literal["bind", "volume"] = "bind"  # compose: volume
    submissions_volume: str = "telar_submissions"
    jobs_dir: str = "~/.telar/jobs"  # solo modo bind
    runner_image: str = "telar-runner:0.5.1"

    # Validación de jobs / semáforo / drainer
    # 0 (o <=0) = sin límite: el tope de timeout por job es OPCIONAL.
    max_timeout_s: int = 0
    max_concurrent_jobs: int = 2
    max_code_bytes: int = 262144
    max_output_bytes: int = 262144

    # Autoría (admin). VARIANTE DE DESPLIEGUE, no login: el modo admin se
    # enciende con TELAR_ADMIN_MODE (app local en loopback distribuida solo a
    # admins). Sin la var ⇒ despliegue "estudiante": /admin/* apagado (401).
    # pydantic-settings castea "1"/"true"/"yes" (y variantes) a bool. Ver
    # api-contract §10.0.
    admin_mode: bool = False

    @property
    def admin_enabled(self) -> bool:
        """``True`` si el modo admin está habilitado por despliegue (TELAR_ADMIN_MODE)."""
        return self.admin_mode

    @property
    def allowed_origins_list(self) -> list[str]:
        """Lista normalizada para CORS y la validación de Origin del WS."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def db_path_expanded(self) -> Path:
        """Ruta de la DB con ``~`` expandido."""
        return Path(self.db_path).expanduser()

    @property
    def jobs_dir_expanded(self) -> Path:
        """Directorio de jobs (modo bind) con ``~`` expandido."""
        return Path(self.jobs_dir).expanduser()


@lru_cache
def get_settings() -> Settings:
    """Instancia única de configuración (cacheada por proceso)."""
    return Settings()
