#!/usr/bin/env python3
"""Auto-test de la puerta T1. Córrelo ANTES de confiar en `brand-invariance.py`.

Una puerta de verificación en la que no has comprobado que FALLA cuando debe
fallar no es una puerta: es un sello de goma. Este script somete al
neutralizador a casos reales de este repo y verifica las dos mitades:

  · ACEPTA  un rebrand nominal correcto (no debe dar falsos positivos)
  · RECHAZA un cambio de forma escondido dentro de un rebrand nominal

Uso:  python3 selftest-invariance.py     (exit 0 = la puerta es de fiar)
"""

from __future__ import annotations

import sys

from brand_invariance_lib import neutralize

# ── Casos tomados literalmente del repo ──────────────────────────────────────
# (antes, después_nominal, descripción)
NOMINAL: list[tuple[str, str, str]] = [
    (
        'EHPC_SUBMISSIONS_VOLUME: ehpc_submissions',
        'TELAR_SUBMISSIONS_VOLUME: telar_submissions',
        "C2/C3 compose: env var + volumen",
    ),
    (
        '  ehpc_submissions:\n    name: ehpc_submissions',
        '  telar_submissions:\n    name: telar_submissions',
        "C3 volumen con name: explícito (el bug ya corregido)",
    ),
    (
        "contextBridge.exposeInMainWorld('ehpc', api)",
        "contextBridge.exposeInMainWorld('telar', api)",
        "C4 preload",
    ),
    (
        "import type { EhpcApi } from '../types/ehpc-api'",
        "import type { TelarApi } from '../types/telar-api'",
        "C4 símbolo TS + ruta del contrato",
    ),
    (
        '  interface Window { ehpc?: EhpcApi }',
        '  interface Window { telar?: TelarApi }',
        "C4 declaración global",
    ),
    (
        "const SIDE_STORAGE_KEY = 'ehpc-learn-side'",
        "const SIDE_STORAGE_KEY = 'telar-learn-side'",
        "C3 clave de localStorage",
    ),
    (
        'db_path: str = "~/.ehpc/ehpc.db"',
        'db_path: str = "~/.telar/telar.db"',
        "C3 ruta de estado persistido",
    ),
    (
        'model_config = SettingsConfigDict(env_prefix="EHPC_", extra="ignore")',
        'model_config = SettingsConfigDict(env_prefix="TELAR_", extra="ignore")',
        "C2 prefijo pydantic-settings",
    ),
    (
        '# Plataforma educativa E-HPC para aprender OpenMP',
        '# Plataforma educativa Telar para aprender OpenMP',
        "C1 prosa",
    ),
    (
        'appId: edu.ehpc.desktop',
        'appId: edu.telar.desktop',
        "C3/D3 appId de electron-builder",
    ),
    (
        'image: ghcr.io/jorgesierra/ehpc-runner:0.5.1',
        'image: ghcr.io/jorgesierra/telar-runner:0.5.1',
        "D3 imagen del registry",
    ),
    (
        'build: ./e-hpc/frontend',
        'build: ./telar/frontend',
        "C5 ruta del directorio raíz",
    ),
    (
        '# `telar` puede alternar estudiante⇄admin',
        '# `telar` puede alternar estudiante⇄admin',
        "telar PREEXISTENTE: intacto, no debe generar diff",
    ),
    (
        'name=f"ehpc-drainer-{job_id}"',
        'name=f"telar-drainer-{job_id}"',
        "C3 nombre de tarea asyncio",
    ),
    (
        'El término HPC (high-performance computing) es genérico.',
        'El término HPC (high-performance computing) es genérico.',
        "falso positivo: HPC genérico intacto",
    ),
]

# Cambios de FORMA escondidos dentro de un rebrand nominal. T1 DEBE cazarlos.
SHAPE_CHANGES: list[tuple[str, str, str]] = [
    (
        'EHPC_MAX_TIMEOUT_S: 120',
        'TELAR_MAX_TIMEOUT_S: 180',
        "valor de configuración alterado de paso",
    ),
    (
        '  interface Window { ehpc?: EhpcApi }',
        '  interface Window { telar: TelarApi }',
        "opcionalidad del contrato eliminada (?)",
    ),
    (
        'def get_settings() -> Settings:\n    return Settings()',
        'def get_settings() -> Settings:\n    return Settings()  # cache\n',
        "línea añadida a hurtadillas",
    ),
    (
        'ports: ["127.0.0.1:8080:80"]',
        'ports: ["0.0.0.0:8080:80"]',
        "regla de seguridad del bind a loopback rota",
    ),
    (
        'submissions_volume: str = "ehpc_submissions"',
        'submissions_volume: str = "telar-submissions"',
        "guion bajo -> guion: nombre de volumen INCOMPATIBLE",
    ),
    (
        'EHPC_ADMIN_MODE: "${EHPC_ADMIN_MODE:-0}"',
        'TELAR_ADMIN_MODE: "${TELAR_ADMIN_MODE:-1}"',
        "modo admin encendido por defecto (fallo de seguridad)",
    ),
    (
        'export interface EhpcApi {',
        'export interface Telar_Api {',
        "clase de mayúsculas incorrecta en el símbolo",
    ),
]


def main() -> int:
    failures: list[str] = []

    print("── Mitad 1: T1 debe ACEPTAR un rebrand nominal ──")
    for before, after, desc in NOMINAL:
        if neutralize(before.encode()) == neutralize(after.encode()):
            print(f"  ok    {desc}")
        else:
            print(f"  FALLO {desc}  <- falso positivo: T1 rechaza un cambio legítimo")
            failures.append(f"falso positivo: {desc}")

    print("\n── Mitad 2: T1 debe RECHAZAR un cambio de forma ──")
    for before, after, desc in SHAPE_CHANGES:
        if neutralize(before.encode()) != neutralize(after.encode()):
            print(f"  ok    cazado: {desc}")
        else:
            print(f"  FALLO NO cazado: {desc}  <- la puerta es ciega a esto")
            failures.append(f"falso negativo: {desc}")

    print()
    if failures:
        print(f"AUTO-TEST FALLIDO — {len(failures)} problema(s):")
        for f in failures:
            print(f"  · {f}")
        print("\nNO uses brand-invariance.py hasta arreglar esto.")
        return 1

    print(f"AUTO-TEST OK — {len(NOMINAL)} casos nominales aceptados, "
          f"{len(SHAPE_CHANGES)} cambios de forma cazados.")
    print("La puerta T1 es de fiar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
