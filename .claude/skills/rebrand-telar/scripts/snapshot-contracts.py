#!/usr/bin/env python3
"""T2 — snapshot de los contratos runtime (antes -> después).

T1 demuestra que el ÁRBOL no cambió de forma. T2 demuestra que el SISTEMA EN
MARCHA tampoco: mismos endpoints, mismos campos, misma secuencia de mensajes
WS. Es la única prueba que ve el comportamiento real, no el texto.

Captura, contra un stack en pie:
  · /openapi.json           — las 24 rutas y los 15 esquemas, el contrato entero
  · /health, /api/v1/system — estado y capacidades
  · /api/v1/modules         — catálogo
  · una lección y su quiz   — contenido
  · un job `spmd` real      — registro final + secuencia de mensajes WS

Todo se NEUTRALIZA (misma función que T1) antes de guardar: así el snapshot de
antes y el de después se comparan con `diff` directamente, sin que el cambio de
marca genere ruido. Lo que sobreviva a la neutralización y siga difiriendo es
un cambio de comportamiento real.

Uso:
    python3 snapshot-contracts.py --label antes     # con el stack VIEJO en pie
    # …rebrand…
    python3 snapshot-contracts.py --label despues   # con el stack NUEVO en pie
    diff -ru ~/.telar-rebrand/snapshots/antes ~/.telar-rebrand/snapshots/despues

Opciones: --no-job omite el job real (evita crear un contenedor efímero).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brand_invariance_lib import neutralize  # noqa: E402

BASE = "http://127.0.0.1:8000"
ORIGIN = "http://127.0.0.1:8080"
EXAMPLE_ID = "spmd"
LESSON_ID = "spmd"
OUT_ROOT = Path.home() / ".telar-rebrand" / "snapshots"


def get(path: str) -> tuple[int, bytes]:
    req = urllib.request.Request(BASE + path, headers={"Origin": ORIGIN})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except OSError as e:
        return 0, str(e).encode()


def post(path: str, body: dict) -> tuple[int, bytes]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, method="POST",
        headers={"Content-Type": "application/json", "Origin": ORIGIN},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except OSError as e:
        return 0, str(e).encode()


# Claves cuyo VALOR cambia en cada ejecución aunque el contrato sea idéntico.
# Se redactan (la clave y su tipo se conservan) o el diff antes/después sería
# ruido puro y la prueba no valdría nada. Todo lo demás conserva su valor: así
# un campo renombrado, borrado o con otro valor SÍ salta.
VOLATILE_KEYS = {
    # identidad y tiempos
    "job_id", "last_job_id", "ts", "created_at", "started_at", "finished_at",
    "updated_at", "wall_time_ms", "duration_ms", "uptime_s", "ws_url",
    # NO se redactan a propósito:
    #  · `detail` — es el campo de error de FastAPI. Blanquearlo dejaría pasar
    #    una regresión que cambiase el mensaje de error manteniendo el status.
    #    No hace falta: en la secuencia WS sólo se guardan los NOMBRES de las
    #    claves, nunca el valor de `detail`.
    #  · `href` — HEX_ID ya normaliza el id que lleva dentro, así que la RUTA
    #    ('/api/v1/jobs/<id>') sigue comparándose: si cambiara el prefijo del
    #    endpoint, saltaría.
    # telemetría del contenedor
    "cpu_percent", "cpu_percent_avg", "cpu_percent_max", "mem_used_bytes",
    "mem_used_bytes_max", "mem_percent", "mem_limit_bytes", "pids", "pids_max",
    "samples", "throttled_periods", "online_cpus", "total_log_bytes",
    "cores", "version", "app_version",
    # MEDICIONES del job: cambian en cada ejecución por definición (es un
    # barrido de hilos con tiempos reales). Su FORMA sí se compara: las claves
    # threads/speedup/efficiency/time_s siguen ahí y `parsed_timings.kind`
    # conserva su valor.
    "time_s", "speedup", "efficiency", "stdout", "stderr",
}

# Cualquier id hexadecimal de 32 caracteres, esté bajo la clave que esté
# (p.ej. incrustado en `href`). Se redacta por VALOR, no por clave.
HEX_ID = re.compile(r"\b[0-9a-f]{32}\b")


def redact(node):
    """Sustituye los valores volátiles por su TIPO, recursivamente."""
    if isinstance(node, dict):
        return {
            k: (f"<{type(v).__name__}>" if k in VOLATILE_KEYS and not isinstance(v, (dict, list))
                else redact(v))
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [redact(v) for v in node]
    if isinstance(node, str):
        return HEX_ID.sub("<id>", node)
    return node


def save(out: Path, name: str, status: int, raw: bytes,
         dependiente_de_db: bool = False) -> None:
    """Guarda la respuesta completa y su FORMA comparable.

    - raw/<name>       respuesta íntegra, para inspección humana.
    - shape/<name>     forma con los volátiles redactados. ESTA es la que compara
                       la puerta y la que debe salir idéntica antes/después.
    - contenido/<name> igual, pero para endpoints que dependen del estado de la
                       DB: se inspeccionan a ojo, no se exigen idénticos.

    Todo neutralizado (misma función que T1) y con las claves ordenadas.
    """
    try:
        parsed = json.loads(raw)
        full = json.dumps(parsed, indent=2, sort_keys=True, ensure_ascii=False)
        shape = json.dumps(redact(parsed), indent=2, sort_keys=True, ensure_ascii=False)
    except (json.JSONDecodeError, UnicodeDecodeError):
        full = shape = raw.decode("utf-8", "surrogateescape")

    shape_dir = "contenido" if dependiente_de_db else "shape"
    for sub, text in (("raw", full), (shape_dir, shape)):
        body = f"# HTTP {status}\n{text}\n".encode("utf-8", "surrogateescape")
        (out / sub / name).write_bytes(neutralize(body))
    marca = " (depende de la DB)" if dependiente_de_db else ""
    print(f"  · {name:<28} HTTP {status}{marca}")


# El cliente WS corre DENTRO del contenedor del backend: el host no tiene la
# librería `websockets` y añadirla al repo sería tocar dependencias en mitad
# de un rebrand. Sólo lee; no altera el contenedor.
WS_CLIENT = r"""
import asyncio, json, sys, websockets

async def main():
    job_id, origin = sys.argv[1], sys.argv[2]
    url = f"ws://127.0.0.1:8000/ws/jobs/{job_id}"
    seq = []
    try:
        async with websockets.connect(url, additional_headers={"Origin": origin}) as ws:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=240)
                msg = json.loads(raw)
                # Se guarda la FORMA, no el contenido volátil: tipo, fase y el
                # conjunto de claves. Los timestamps y el stdout cambian en cada
                # ejecución y generarían ruido en el diff.
                seq.append({
                    "type": msg.get("type"),
                    "phase": msg.get("phase") or (msg.get("data") or {}).get("phase"),
                    "keys": sorted(msg.keys()),
                })
                if msg.get("type") in ("eof", "done", "error", "terminal"):
                    break
    except Exception as exc:
        seq.append({"cierre": type(exc).__name__})

    # El ORDEN de los mensajes NO es determinista y no debe compararse:
    #   · `log` y `metrics` se intercalan segun el timing del job;
    #   · si el job arranca rapido, el cliente puede conectarse ya pasada la
    #     fase `creating` y no verla nunca.
    # Comparar la secuencia literal daria una puerta INTERMITENTE, que es peor
    # que no tener puerta. Lo que el contrato fija de verdad es QUE MENSAJES
    # existen y QUE CAMPOS lleva cada uno, y eso si es estable.
    # Tampoco se guarda el NUMERO de mensajes ni la lista de fases observadas:
    # ambos dependen del timing (cuantas muestras de `metrics` da tiempo a
    # emitir, si el cliente llego antes o despues de `creating`). La forma de un
    # mensaje `status` es la misma sea cual sea su fase, asi que perderse una
    # fase no altera lo que se compara.
    formas = sorted(
        {json.dumps({"type": m.get("type"), "keys": m.get("keys")}, sort_keys=True)
         for m in seq if "type" in m}
    )
    print(json.dumps({
        "formas_distintas": [json.loads(f) for f in formas],
        "llega_eof": any(m.get("type") == "eof" for m in seq),
    }, indent=2, sort_keys=True))

asyncio.run(main())
"""


def capture_ws(container: str, job_id: str) -> bytes:
    try:
        r = subprocess.run(
            ["docker", "exec", "-i", container, "python", "-c", WS_CLIENT, job_id, ORIGIN],
            capture_output=True, timeout=300,
        )
        return r.stdout or r.stderr
    except (subprocess.SubprocessError, OSError) as exc:
        return f'[{{"error": "no se pudo capturar el WS: {exc}"}}]'.encode()


def main() -> int:
    ap = argparse.ArgumentParser(description="T2 — snapshot de contratos runtime")
    ap.add_argument("--label", required=True, help="nombre del snapshot (p.ej. antes / despues)")
    ap.add_argument("--no-job", action="store_true", help="no lanzar un job real")
    ap.add_argument("--container", default="e-hpc-backend-1",
                    help="contenedor del backend (para el cliente WS)")
    args = ap.parse_args()

    out = OUT_ROOT / args.label
    for sub in ("raw", "shape", "contenido"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    print(f"T2 — capturando '{args.label}' en {out}")

    status, raw = get("/health")
    if status != 200:
        print(f"  ERROR: el stack no responde en {BASE} (/health -> {status}).")
        print("  Levántalo antes de capturar:  docker compose up -d")
        return 1
    save(out, "health.json", status, raw)

    for name, path in [
        ("openapi.json", "/openapi.json"),
        ("system.json", "/api/v1/system"),
    ]:
        s, b = get(path)
        save(out, name, s, b)

    # Endpoints cuya respuesta depende del ESTADO DE LA BASE DE DATOS, no del
    # contrato. Van aparte porque C3 renombra el volumen `ehpc_data` y, bajo D2,
    # la DB se recrea desde las fixtures: el catálogo vuelve a sus 8 módulos
    # sembrados, el progreso se vacía y desaparece cualquier módulo creado a
    # mano con el modo autoría. Ese diff NO es una regresión del rebrand, y
    # mezclarlo con el contrato haría inútil la comparación.
    for name, path in [
        ("modules.json", "/api/v1/modules"),
        ("examples.json", "/api/v1/examples"),
        ("progress.json", "/api/v1/progress"),
        (f"lesson-{LESSON_ID}.json", f"/api/v1/lessons/{LESSON_ID}"),
        (f"quiz-{LESSON_ID}.json", f"/api/v1/lessons/{LESSON_ID}/quiz"),
    ]:
        s, b = get(path)
        save(out, name, s, b, dependiente_de_db=True)

    if args.no_job:
        print("  (--no-job: se omite el job real y la captura WS)")
        print(f"\nSnapshot '{args.label}' guardado en {out}")
        return 0

    print("  lanzando un job real 'spmd' (crea un contenedor runner efímero)…")
    s, b = post("/api/v1/jobs", {"example_id": EXAMPLE_ID, "lesson_id": LESSON_ID})
    save(out, "job-create.json", s, b)
    if s != 202:
        print(f"  ERROR: POST /api/v1/jobs -> {s}; sin job no hay captura WS.")
        return 1

    job_id = (json.loads(b).get("data") or {}).get("job_id")
    print(f"  job_id={job_id} — capturando la secuencia WS…")
    ws_raw = neutralize(capture_ws(args.container, job_id))
    # La secuencia WS ya se guarda en forma colapsada: es idéntica en raw/ y shape/.
    (out / "raw" / "ws-sequence.json").write_bytes(ws_raw)
    (out / "shape" / "ws-sequence.json").write_bytes(ws_raw)
    print("  · ws-sequence.json")

    for _ in range(90):
        s, b = get(f"/api/v1/jobs/{job_id}")
        if s == 200 and (json.loads(b).get("data") or {}).get("status") in (
            "completed", "failed", "timeout", "cancelled"
        ):
            break
        time.sleep(4)
    save(out, "job-final.json", s, b)

    s, b = get(f"/api/v1/jobs/{job_id}/output")
    # El stdout del job es volátil (tiempos, orden de hilos): se guarda sólo su
    # forma —número de líneas y si trae las marcas del parser sweep_pi—.
    lines = b.decode("utf-8", "replace").splitlines()
    shape = {
        "http": s,
        "n_lineas": len(lines),
        "no_vacio": len(b) > 0,
        "tiene_threads": any("thread" in ln.lower() for ln in lines),
    }
    save(out, "job-output-shape.json", s, json.dumps(shape).encode())

    print(f"\nSnapshot '{args.label}' guardado en {out}")
    print("\nLa PUERTA (debe salir idéntico byte a byte):")
    print(f"  diff -ru {OUT_ROOT}/antes/shape {OUT_ROOT}/despues/shape")
    print("\nSólo para mirar a ojo (cambia si la DB se recreó, y C3 la recrea):")
    print(f"  diff -ru {OUT_ROOT}/antes/contenido {OUT_ROOT}/despues/contenido")
    return 0


if __name__ == "__main__":
    sys.exit(main())
