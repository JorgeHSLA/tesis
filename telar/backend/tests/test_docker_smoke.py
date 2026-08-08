"""Smoke OPT-IN contra el daemon Docker real y la imagen runner (WP9).

Se ejecuta SOLO con ``pytest -m docker`` (excluido por defecto en pytest.ini).
Requiere el daemon accesible y la imagen ``telar-runner:0.5.1`` construida.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.services.docker_service import DockerService

pytestmark = pytest.mark.docker


@pytest.fixture(scope="module")
def real_service(tmp_path_factory):
    settings = Settings(
        jobs_dir=str(tmp_path_factory.mktemp("smoke-jobs")),
        code_delivery="bind",
    )
    try:
        service = DockerService(settings)
    except Exception as exc:  # daemon inaccesible
        pytest.skip(f"daemon Docker no disponible: {exc}")
    if not service.ping():
        pytest.skip("daemon Docker no responde a ping()")
    if not service.image_present():
        pytest.skip(f"imagen {settings.runner_image} no construida")
    return service


def test_smoke_job_real_end_to_end(real_service):
    """create→start→logs→wait→remove con el sandbox completo de §4."""
    job_id = "wp9smoke"
    code_path = real_service.prepare_code(
        job_id, "print('hola desde el runner')\n"
    )
    execution = real_service.run_job(job_id, code_path, threads=1, timeout_s=60)
    try:
        exit_code = execution.wait(timeout=60)
        stdout = b"".join(execution.iter_logs("stdout"))
        assert exit_code == 0
        assert b"hola desde el runner" in stdout
        assert execution.oom_killed() is False
    finally:
        execution.remove()
        real_service.cleanup_code(job_id)


def test_smoke_reaper_no_lanza(real_service):
    removed, dirs_removed = real_service.reap_orphans()
    assert removed >= 0 and dirs_removed >= 0
