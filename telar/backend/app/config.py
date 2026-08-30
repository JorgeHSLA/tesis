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

    # Catálogo remoto de módulos publicables (api-contract §11.1). Es
    # configuración de DESPLIEGUE, igual que TELAR_ADMIN_MODE: dos alumnos con
    # buckets distintos son dos despliegues distintos.
    #: Vacío ⇒ catálogo remoto DESACTIVADO: todo §11 responde
    #: ``503 CATALOG_DISABLED`` y ``/system`` reporta ``catalog.enabled=false``.
    catalog_bucket: str = ""
    catalog_prefix: str = "modulos/"
    catalog_index: str = "modulos/index.json"
    #: Tope de bytes de un bundle. Se comprueba con el ``size`` del índice antes
    #: de descargar, y OTRA VEZ sobre los bytes recibidos (services/catalog_client).
    catalog_max_bundle_bytes: int = 4194304
    #: Timeout POR OPERACIÓN contra el bucket (no por lectura de socket).
    catalog_timeout_s: int = 15
    #: Frescura del índice cacheado; pasado el TTL se sirve caché con ``stale=true``.
    catalog_cache_ttl_s: int = 900

    # Driver del puerto de catálogo (plan Fase 5, R8). ``gcs`` es producción;
    # ``http_local`` es lo que hace posible el E2E completo sin GCP y solo
    # acepta endpoints de loopback (se rechaza en ARRANQUE, catalog_client).
    catalog_driver: Literal["gcs", "http_local"] = "gcs"
    catalog_endpoint: str = ""  # solo http_local, p.ej. http://127.0.0.1:8099
    catalog_local_root: str = ""  # solo http_local: raíz de escritura del publicador

    # Credencial de ESCRITURA del catálogo (SOLO imagen admin, §11.8.1). El
    # estudiante lee anónimo y jamás necesita credencial.
    gcs_credentials: str = ""  # ruta al JSON de la cuenta de servicio (exige 0600)
    gcs_project_id: str = ""  # opcional: la clave ya trae project_id

    @property
    def admin_enabled(self) -> bool:
        """``True`` si el modo admin está habilitado por despliegue (TELAR_ADMIN_MODE)."""
        return self.admin_mode

    @property
    def catalog_enabled(self) -> bool:
        """``True`` si este despliegue tiene catálogo remoto (§11.1).

        Un único sitio decide «desactivado» para que ``/system`` y los routers
        de §11 no puedan discrepar.
        """
        return bool(self.catalog_bucket)

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
