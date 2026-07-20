"""Paridad entre el compose raíz y el compose empaquetado del desktop
(auditoría BL-02/BL-12).

El desktop shell despliega con su propio compose empaquetado
(``desktop/resources/compose/compose.yaml``), que debe ser un espejo exacto
del compose raíz (``compose.yaml``) en los dos puntos que ya causaron
incidentes y que este test evita que se vuelvan a colar:

- **BL-02**: el volumen ``ehpc_submissions`` necesita ``name:`` explícito
  para desactivar el prefijo de proyecto de Compose. El compose empaquetado
  fija ``name: ehpc`` a nivel de proyecto; sin el ``name:`` explícito en el
  volumen, Compose crearía ``ehpc_ehpc_submissions`` mientras el runner
  sigue montando el literal de ``EHPC_SUBMISSIONS_VOLUME``
  (``ehpc_submissions``) → volumen vacío → **todos los jobs fallan** con
  "no such file or directory" (Modo A, ver
  ``app/services/docker_service.py::_code_mount_kwargs``).
- **BL-12**: ``EHPC_ALLOWED_ORIGINS`` del compose empaquetado quedó
  desactualizada (sin las variantes ``127.0.0.1``), lo que rompe CORS/WS en
  cuanto el navegador manda ``Origin: http://127.0.0.1:8080``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

ROOT_COMPOSE = Path(__file__).resolve().parents[2] / "compose.yaml"
DESKTOP_COMPOSE = (
    Path(__file__).resolve().parents[2]
    / "desktop"
    / "resources"
    / "compose"
    / "compose.yaml"
)

_LABELS = {
    "root_compose": "compose.yaml (raíz)",
    "desktop_compose": "desktop/resources/compose/compose.yaml",
}


def _load(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="module")
def root_compose() -> dict:
    return _load(ROOT_COMPOSE)


@pytest.fixture(scope="module")
def desktop_compose() -> dict:
    return _load(DESKTOP_COMPOSE)


def _volume_name(compose: dict) -> str | None:
    """``name:`` explícito de volumes.ehpc_submissions, o None si no está."""
    volume = compose.get("volumes", {}).get("ehpc_submissions")
    return volume.get("name") if isinstance(volume, dict) else None


def _backend_env(compose: dict, key: str) -> object:
    return compose["services"]["backend"]["environment"][key]


# ───────────────────── BL-02: name: explícito del volumen ────────────────────


@pytest.mark.parametrize("compose_fixture", ["root_compose", "desktop_compose"])
def test_volumen_ehpc_submissions_tiene_name_explicito(compose_fixture, request):
    compose = request.getfixturevalue(compose_fixture)
    label = _LABELS[compose_fixture]
    volume_name = _volume_name(compose)
    assert volume_name == "ehpc_submissions", (
        f"BL-02: {label} no declara `name: ehpc_submissions` explícito en el "
        "volumen `volumes.ehpc_submissions`. Sin ese `name:` explícito, con "
        "el `name:` de proyecto Compose fijado (p.ej. `name: ehpc`), Compose "
        "crea el volumen prefijado `ehpc_ehpc_submissions` mientras el "
        "runner sigue montando el literal de EHPC_SUBMISSIONS_VOLUME "
        "(`ehpc_submissions`) → monta un volumen vacío/distinto → TODOS los "
        "jobs fallan con 'no such file or directory' (Modo A)."
    )


# ─────────────────────── BL-12: EHPC_ALLOWED_ORIGINS idéntico ────────────────


def test_allowed_origins_identico_entre_compose(root_compose, desktop_compose):
    root_origins = _backend_env(root_compose, "EHPC_ALLOWED_ORIGINS")
    desktop_origins = _backend_env(desktop_compose, "EHPC_ALLOWED_ORIGINS")
    assert desktop_origins == root_origins, (
        "BL-12: EHPC_ALLOWED_ORIGINS difiere entre compose.yaml (raíz) y "
        "desktop/resources/compose/compose.yaml. El compose empaquetado del "
        "desktop reintrodujo una lista vieja sin las variantes 127.0.0.1: el "
        "navegador manda `Origin: http://127.0.0.1:8080` y el backend "
        f"rechazaría ese origen (CORS/WS rotos). raíz={root_origins!r} "
        f"desktop={desktop_origins!r}"
    )


# ─────────────── BL-02: paridad EHPC_SUBMISSIONS_VOLUME (env ↔ env) ──────────


def test_submissions_volume_env_identica_entre_compose(root_compose, desktop_compose):
    root_env = _backend_env(root_compose, "EHPC_SUBMISSIONS_VOLUME")
    desktop_env = _backend_env(desktop_compose, "EHPC_SUBMISSIONS_VOLUME")
    assert desktop_env == root_env, (
        "BL-02: EHPC_SUBMISSIONS_VOLUME difiere entre compose.yaml (raíz) y "
        "desktop/resources/compose/compose.yaml; backend y runner deben "
        "acordar el mismo literal de volumen o el montaje del código del "
        "estudiante falla con 'no such file or directory'."
    )


# ─────────────── BL-02: paridad EHPC_SUBMISSIONS_VOLUME (env ↔ volumen) ──────


@pytest.mark.parametrize("compose_fixture", ["root_compose", "desktop_compose"])
def test_submissions_volume_env_coincide_con_name_del_volumen(compose_fixture, request):
    compose = request.getfixturevalue(compose_fixture)
    label = _LABELS[compose_fixture]
    env_value = _backend_env(compose, "EHPC_SUBMISSIONS_VOLUME")
    volume_name = _volume_name(compose)
    assert volume_name == env_value, (
        f"BL-02: en {label}, EHPC_SUBMISSIONS_VOLUME={env_value!r} no "
        f"coincide con el `name:` explícito del volumen `ehpc_submissions` "
        f"({volume_name!r}). El backend escribe el código del estudiante en "
        "el volumen EHPC_SUBMISSIONS_VOLUME y el runner monta ese mismo "
        "literal como source; si no coinciden con el nombre real del "
        "volumen Docker, el runner monta un volumen vacío/distinto → "
        "'no such file or directory' (Modo A)."
    )
