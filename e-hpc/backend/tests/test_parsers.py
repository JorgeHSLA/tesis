"""Suite 5 (architecture §11): los 6 parser_id contra los stdout LITERALES
de examples-content.md §6 (fixtures en tests/fixtures/stdout/).

Reglas §7.2: orden no determinista (solo conjunto), output truncado ⇒ null,
speedup(n)=t(1)/t(n), eficiencia(n)=speedup(n)/n, pair con
speedup_vs_reference = referencia/paralelo.
"""

from __future__ import annotations

import pytest

from app.services.output_parser import PARSER_IDS, parse_output

from conftest import load_stdout


def test_los_6_parser_ids_congelados():
    assert PARSER_IDS == {
        "none", "sweep_pi", "sweep_transporte",
        "pair_openmp_numpy", "pair_openmp_blas", "pair_parallel_serial",
    }


# ─────────────────────────────── sweep_pi ────────────────────────────────────


def test_sweep_pi_spmd_literal():
    result = parse_output("sweep_pi", load_stdout("sweep_pi_spmd.txt"))
    assert result["parser_id"] == "sweep_pi"
    assert result["kind"] == "sweep"
    assert result["correct"] is None and result["extra"] == {}
    series = result["series"]
    assert [p["threads"] for p in series] == [1, 2, 4, 8]
    assert series[0]["time_s"] == 0.812
    assert series[0]["speedup"] == 1.0 and series[0]["efficiency"] == 1.0
    # spmd NO escala (false sharing): speedup ~1 con 8 hilos — no es error
    assert series[3]["speedup"] == pytest.approx(0.812 / 0.902, abs=0.01)


def test_sweep_pi_critical_literal_escala():
    result = parse_output("sweep_pi", load_stdout("sweep_pi_critical.txt"))
    series = result["series"]
    assert series[1]["speedup"] == pytest.approx(0.812 / 0.418, abs=0.01)
    assert series[3]["speedup"] == pytest.approx(0.812 / 0.119, abs=0.01)
    assert series[3]["efficiency"] == pytest.approx(series[3]["speedup"] / 8, abs=0.01)


def test_sweep_orden_no_determinista():
    """Regla 2 §7.2: jamás asumir orden de líneas — solo conjunto."""
    shuffled = "\n".join(reversed(load_stdout("sweep_pi_critical.txt").splitlines()))
    result = parse_output("sweep_pi", shuffled)
    assert result is not None
    assert [p["threads"] for p in result["series"]] == [8, 4, 2, 1]
    by_threads = {p["threads"]: p for p in result["series"]}
    assert by_threads[1]["speedup"] == 1.0  # el baseline sigue siendo t(1)
    assert by_threads[8]["speedup"] == pytest.approx(0.812 / 0.119, abs=0.01)


def test_sweep_sin_baseline_devuelve_null():
    sin_uno = "\n".join(
        line for line in load_stdout("sweep_pi_critical.txt").splitlines()
        if not line.startswith("hilos = 1 ")
    )
    assert parse_output("sweep_pi", sin_uno) is None


# ─────────────────────────── sweep_transporte ────────────────────────────────


def test_sweep_transporte_literal_contrato():
    result = parse_output(
        "sweep_transporte", load_stdout("sweep_transporte.txt")
    )
    assert result["parser_id"] == "sweep_transporte"
    assert result["kind"] == "sweep"
    series = result["series"]
    # valores EXACTOS del ejemplo de api-contract §7.4
    assert series[0] == {
        "threads": 1, "time_s": 0.726, "speedup": 1.0, "efficiency": 1.0
    }
    assert series[1]["speedup"] == 2.84
    assert series[1]["efficiency"] == 1.42
    assert series[2]["speedup"] == 4.2
    assert series[3]["speedup"] == 7.98
    assert result["extra"] == {
        "transmitidas_pct": 2.35, "reflejadas_pct": 20.85, "absorbidas_pct": 76.8
    }
    assert result["correct"] is None


# ─────────────────────────────── pairs ───────────────────────────────────────


def test_pair_openmp_numpy_literal():
    result = parse_output(
        "pair_openmp_numpy", load_stdout("pair_suma_vectores.txt")
    )
    assert result == {
        "parser_id": "pair_openmp_numpy",
        "kind": "pair",
        "parallel_time_s": 0.0189,
        "reference_time_s": 0.0242,  # ojo al espacio de "numpy :" (§6)
        "reference_label": "numpy",
        "speedup_vs_reference": round(0.0242 / 0.0189, 2),
        "correct": True,
    }


def test_pair_openmp_blas_literal():
    result = parse_output("pair_openmp_blas", load_stdout("pair_matrices.txt"))
    assert result["reference_label"] == "blas"
    assert result["parallel_time_s"] == 0.412
    assert result["reference_time_s"] == 0.031  # np.dot con sufijo "(BLAS...)"
    assert result["speedup_vs_reference"] == round(0.031 / 0.412, 2)
    assert result["correct"] is True


def test_pair_parallel_serial_literal():
    result = parse_output(
        "pair_parallel_serial", load_stdout("pair_stencil.txt")
    )
    assert result["reference_label"] == "serial"
    assert result["parallel_time_s"] == 0.912
    assert result["reference_time_s"] == 0.989  # "serial  :" con 2 espacios
    assert result["speedup_vs_reference"] == 1.08  # del contrato §7.4
    assert result["correct"] is True  # "paralelo == serial? True"


def test_pair_correct_false():
    stdout = load_stdout("pair_suma_vectores.txt").replace(
        "correcto? True", "correcto? False"
    )
    result = parse_output("pair_openmp_numpy", stdout)
    assert result["correct"] is False


def test_pair_incompleto_devuelve_null():
    solo_paralelo = "tiempo openmp: 0.5 s\n"
    assert parse_output("pair_openmp_numpy", solo_paralelo) is None


# ─────────────────────────────── none ────────────────────────────────────────


@pytest.mark.parametrize("fixture", [
    "none_hello.txt",         # orden no determinista (impreso desde @njit)
    "none_for_pi.txt",
    "none_entorno_datos.txt",
    "none_mandelbrot.txt",    # valores irreproducibles A PROPÓSITO (no error)
    "none_monte_carlo.txt",
    "none_pi_task.txt",
    "none_fibonacci.txt",
])
def test_parser_none_jamas_parsea(fixture):
    assert parse_output("none", load_stdout(fixture)) is None


def test_asserts_de_correccion_presentes_en_fixtures():
    """Regla 6 §6: los valores sirven como verificación de corrección."""
    assert "pi = 3.141592653589794" in load_stdout("none_pi_task.txt")
    assert "fib( 35 ) = 9227465" in load_stdout("none_fibonacci.txt")
    assert "correcto? True" in load_stdout("pair_suma_vectores.txt")
    assert "paralelo == serial? True" in load_stdout("pair_stencil.txt")


# ────────────────────────── reglas transversales ─────────────────────────────


def test_truncado_jamas_se_parsea():
    stdout = load_stdout("sweep_transporte.txt")
    assert parse_output("sweep_transporte", stdout, truncated=True) is None
    assert parse_output("pair_openmp_numpy",
                        load_stdout("pair_suma_vectores.txt"),
                        truncated=True) is None


def test_stdout_vacio_o_none():
    assert parse_output("sweep_pi", "") is None
    assert parse_output("sweep_pi", None) is None


def test_parser_desconocido_no_rompe_el_finish():
    assert parse_output("parser_inventado", "hilos = 1 | ...") is None


def test_formato_que_no_casa_devuelve_null():
    assert parse_output("sweep_pi", load_stdout("none_hello.txt")) is None
    assert parse_output("sweep_transporte", load_stdout("none_fibonacci.txt")) is None
    assert parse_output("pair_parallel_serial", load_stdout("none_for_pi.txt")) is None
