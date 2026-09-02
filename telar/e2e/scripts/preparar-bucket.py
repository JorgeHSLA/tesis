#!/usr/bin/env python3
"""Prepara un bucket falso para el E2E del catálogo remoto.

No hay GCP en la máquina de pruebas, y no debería hacer falta: el backend tiene
dos adaptadores del puerto de lectura (`TELAR_CATALOG_DRIVER`), y el
`http_local` habla el MISMO protocolo contra un servidor estático en loopback.
Los dos recorren idéntico código de validación, checksum, instalación y merge;
lo único que cambia es el transporte.

Genera, a partir del contenido REAL del repo:
  modulos/index.json          — el catálogo
  modulos/<id>/v<n>.json      — los bundles, inmutables

Uso:
    python3 preparar-bucket.py <directorio-del-bucket> [--version 1|2]

Si `TELAR_E2E_GCS_BUCKET` está definida, además de escribir el directorio
local publica lo generado en ese bucket REAL de GCS. Así el mismo recorrido
E2E sirve para el bucket falso en loopback y para Google, sin tocar la spec.

Con `--version 2` el índice apunta a la v2 de `mFundamentos`, que añade una
lección conceptual. Es lo que convierte el E2E en una prueba de CU-39: el
estudiante aprueba un quiz en la v1 y comprueba que su avance sigue ahí tras
actualizar.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))

from app.services.catalog_hash import bundle_checksum  # noqa: E402

FECHA = "2026-08-30T12:00:00.000Z"

#: §11.8.2 — el índice es MUTABLE: es lo único que dice cuál es la versión
#: vigente, así que una copia rancia en el borde de Google rompe CU-38.
CACHE_INDICE = "no-cache, max-age=0, must-revalidate"
#: §11.10 — un bundle publicado no se reescribe NUNCA, así que cachearlo un año
#: es correcto y además ahorra operaciones Clase B del nivel gratuito.
CACHE_BUNDLE = "public, max-age=31536000, immutable"
CONTENIDO = RAIZ / "backend" / "app" / "content"


def _leccion(
    lid: str, orden: int, titulo: str, markdown: str, *,
    minutos: int = 10, regla: str = "quiz", video: str | None = None,
    ejemplo: dict | None = None, quiz: dict | None = None,
) -> dict:
    return {
        "id": lid, "order": orden, "title": titulo,
        "estimated_minutes": minutos, "content_markdown": markdown,
        "video_url": video, "enabled": True, "completion_rule": regla,
        "pass_threshold": 0.6 if quiz is None else quiz["pass_threshold"],
        "recommended": [], "example": ejemplo, "quiz": quiz,
    }


def _ejemplo(eid: str, archivo: str, codigo: str) -> dict:
    return {
        "id": eid, "filename": archivo, "title": "Ejemplo del módulo",
        "difficulty": 2, "teaches": "identidad de hilo y región paralela",
        "directives": ["parallel"], "threads_configurable": True,
        "fixed_threads": None, "fixed_threads_note": None,
        "sweeps_threads": False, "self_measures": False, "parser_id": "none",
        "default_timeout_s": 30, "est_run_seconds": 5, "enabled": True,
        "requires_gpu": False, "expected_output_note": "N líneas 'Hello from thread'",
        "takeaways": ["Los hilos comparten memoria", "El orden no es determinista"],
        "source_code": codigo,
    }


def _quiz(lid: str, preguntas: list[tuple[str, str, str]]) -> dict:
    return {
        "pass_threshold": 0.6,
        "questions": [
            {
                "id": f"{lid}-q{i}", "order": i, "text": texto,
                "options": [{"key": "a", "text": a}, {"key": "b", "text": b}],
                "correct_key": "a", "explanation": "Se explica en la lección.",
            }
            for i, (texto, a, b) in enumerate(preguntas, start=1)
        ],
    }


def _bundle(mid: str, titulo: str, version: int, lecciones: list[dict]) -> dict:
    bundle = {
        "bundle_format": 1,
        "module": {
            "id": mid, "order_hint": 30, "title": titulo,
            "description": "Publicado desde el bucket para la verificación E2E.",
            "level": "Básico", "version": version, "published_at": FECHA,
            "author_label": "Curso Telar", "notes": "",
        },
        "lessons": lecciones,
    }
    bundle["checksum"] = bundle_checksum(bundle)
    return bundle


def construir() -> dict[str, dict[int, dict]]:
    """Los bundles de la verificación, por módulo y versión."""
    codigo = (CONTENIDO / "examples" / "primerEjemplo" / "main.py").read_text(
        encoding="utf-8"
    )
    hilo = _leccion(
        "f1Hilo", 1, "¿Qué es un hilo?",
        "# ¿Qué es un hilo?\n\nUn **proceso** es un programa en ejecución con su "
        "propia memoria. Un **hilo** es una unidad de ejecución dentro de ese "
        "proceso.\n\nLa analogía: el proceso es una casa; los hilos, las personas "
        "que viven en ella. Comparten la nevera —la memoria— pero cada una tiene "
        "su habitación.",
        minutos=5, regla="viewed",
        video="https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=NoDeberiaSobrevivir",
    )
    practica = _leccion(
        "f1Practica", 2, "Tu primera región paralela",
        "# Tu primera región paralela\n\nEl bloque `with openmp(\"parallel\")` "
        "marca dónde empieza y acaba el trabajo repartido entre hilos.",
        minutos=15,
        ejemplo=_ejemplo("f1Ej", "hola.py", codigo),
        quiz=_quiz("f1Practica", [
            ("¿Qué delimita la región paralela?",
             "El bloque with openmp(\"parallel\")", "Las llaves { }"),
            ("¿Cuántos hilos se crean por defecto?",
             "Tantos como procesadores lógicos", "Siempre cuatro"),
        ]),
    )
    concurrencia = _leccion(
        "f1Concurrencia", 3, "Concurrencia no es paralelismo",
        "# Concurrencia no es paralelismo\n\nUn solo barista atiende a diez "
        "clientes «a la vez» sin hacer dos cafés simultáneos: eso es "
        "**concurrencia**. Cuatro baristas haciendo cuatro cafés a la vez es "
        "**paralelismo**.",
        minutos=5, regla="viewed",
    )
    return {
        "mFundamentos": {
            1: _bundle("mFundamentos", "Fundamentos de paralelismo", 1, [hilo, practica]),
            2: _bundle("mFundamentos", "Fundamentos de paralelismo", 2,
                       [hilo, practica, concurrencia]),
        },
        "mExtra": {
            1: _bundle("mExtra", "Módulo que nadie incorpora", 1, [
                _leccion("extra1", 1, "Una lección suelta",
                         "# Una lección suelta\n\nExiste para comprobar que el "
                         "estudiante puede NO incorporar lo que no quiere.",
                         minutos=3, regla="viewed"),
            ]),
        },
    }


def escribir(destino: pathlib.Path, version_fundamentos: int) -> None:
    bundles = construir()
    modulos = destino / "modulos"
    modulos.mkdir(parents=True, exist_ok=True)

    entradas = []
    for mid, versiones in bundles.items():
        for numero, bundle in versiones.items():
            crudo = json.dumps(
                bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
            carpeta = modulos / mid
            carpeta.mkdir(exist_ok=True)
            (carpeta / f"v{numero}.json").write_bytes(crudo)

        actual = version_fundamentos if mid == "mFundamentos" else 1
        bundle = versiones[actual]
        crudo = (modulos / mid / f"v{actual}.json").read_bytes()
        entradas.append({
            "id": mid, "title": bundle["module"]["title"],
            "description": bundle["module"]["description"],
            "level": bundle["module"]["level"], "order_hint": bundle["module"]["order_hint"],
            "version": actual, "checksum": bundle["checksum"],
            "object_path": f"modulos/{mid}/v{actual}.json", "size_bytes": len(crudo),
            "published_at": FECHA, "author_label": "Curso Telar",
            "lessons_count": len(bundle["lessons"]),
            "questions_count": sum(
                len(l["quiz"]["questions"]) for l in bundle["lessons"] if l["quiz"]
            ),
            "estimated_minutes_total": sum(l["estimated_minutes"] for l in bundle["lessons"]),
            "requires_gpu": False,
        })

    (modulos / "index.json").write_text(
        json.dumps(
            {"index_format": 1, "generated_at": FECHA, "modules": entradas},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"bucket listo en {destino} · mFundamentos v{version_fundamentos} "
        f"({len(bundles['mFundamentos'][version_fundamentos]['lessons'])} lecciones) "
        f"+ mExtra v1"
    )


def publicar_en_gcs(destino: pathlib.Path, bucket: str) -> None:
    """Sube lo generado al bucket REAL de GCS (`gs://<bucket>/modulos/`).

    Existe para que el MISMO recorrido E2E que corre contra el bucket falso en
    loopback pueda correr contra Google sin tocar ni un test: la spec sigue
    invocando `preparar-bucket.py <dir> --version N`, y es la variable de
    entorno `TELAR_E2E_GCS_BUCKET` la que decide si además se publica.

    **El `Cache-Control` no es cosmético: sin él CU-38 no funciona.** GCS sirve
    los objetos públicos con `Cache-Control: public, max-age=3600` por defecto, y
    la caché de borde de Google entrega esa copia aunque el objeto ya se haya
    reescrito. Verificado contra este mismo bucket: tras publicar la v2, el
    índice se seguía sirviendo en v1 con `age=227`. O sea, el estudiante no se
    entera de que hay versión nueva hasta una hora después de publicarla.

    Por eso se sube con dos políticas distintas, que es lo que exige §11.8.2:

    * `modulos/index.json` **cambia** en cada publicación ⇒ `no-cache`. Es el
      único objeto cuya frescura importa: es quien anuncia qué versión es la
      vigente.
    * `modulos/<id>/v<n>.json` son **inmutables** por contrato (§11.10: una
      versión publicada no se reescribe jamás) ⇒ caché larga. Aquí cachear no
      solo es seguro, es lo correcto: ahorra descargas y operaciones Clase B.

    Se sube además como `application/json` y SIN `contentEncoding`, que es lo que
    espera el adaptador al pedir `Accept-Encoding: identity` para no abrir la
    puerta a una bomba de descompresión.
    """
    gcloud = shutil.which("gcloud")
    if gcloud is None:
        raise SystemExit(
            "TELAR_E2E_GCS_BUCKET está puesto pero no hay `gcloud` en el PATH"
        )
    proyecto = os.environ.get("TELAR_E2E_GCS_PROJECT")

    def _subir(origen: pathlib.Path, destino_gcs: str, cache_control: str) -> None:
        orden = [
            gcloud, "storage", "cp", "-r", str(origen), destino_gcs,
            "--content-type=application/json",
            f"--cache-control={cache_control}",
        ]
        if proyecto:
            orden.append(f"--project={proyecto}")
        hecho = subprocess.run(orden, capture_output=True, text=True)
        if hecho.returncode != 0:
            raise SystemExit(
                f"no se pudo publicar {origen.name} en {destino_gcs}: "
                f"{hecho.stderr.strip()[-500:]}"
            )

    # Primero los bundles (inmutables), después el índice: si el proceso muere a
    # medias, el índice viejo sigue apuntando a bundles que EXISTEN. Al revés
    # dejaría el catálogo anunciando una versión que todavía no se subió.
    for carpeta in sorted((destino / "modulos").iterdir()):
        if carpeta.is_dir():
            _subir(carpeta, f"gs://{bucket}/modulos/", CACHE_BUNDLE)
    _subir(destino / "modulos" / "index.json", f"gs://{bucket}/modulos/index.json",
           CACHE_INDICE)
    print(f"publicado en gs://{bucket}/modulos/ (índice {CACHE_INDICE!r})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destino", type=pathlib.Path)
    parser.add_argument("--version", type=int, default=1, choices=(1, 2))
    args = parser.parse_args()
    escribir(args.destino, args.version)
    bucket = os.environ.get("TELAR_E2E_GCS_BUCKET", "").strip()
    if bucket:
        publicar_en_gcs(args.destino, bucket)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
