from numba.openmp import njit
from numba.openmp import openmp_context as openmp

# Area del conjunto de Mandelbrot por conteo: generamos una malla de puntos c
# y contamos cuantos ESCAPAN (|z| > 2) al iterar z = z^2 + c.
# El clasico ejercicio de Tim Mattson para cazar data races.


@njit
def area_mandelbrot_mal(npoints, maxiter):
    # VERSION CON BUG (a proposito): num_outside es compartida y todos los
    # hilos hacen num_outside += 1 a la vez -> DATA RACE -> resultado variable
    num_outside = 0
    with openmp("parallel for private(j, cr, ci, zr, zi, zr2, zi2, it)"):
        for i in range(npoints):
            for j in range(npoints):
                cr = -2.0 + 2.5 * (i + 0.5) / npoints
                ci = 1.125 * (j + 0.5) / npoints
                zr = cr
                zi = ci
                for it in range(maxiter):
                    zr2 = zr * zr
                    zi2 = zi * zi
                    if zr2 + zi2 > 4.0:
                        num_outside += 1  # <-- RACE: suma sin proteger
                        break
                    zi = 2.0 * zr * zi + ci
                    zr = zr2 - zi2 + cr
    return 2.0 * 2.5 * 1.125 * (npoints * npoints - num_outside) / (npoints * npoints)


@njit
def area_mandelbrot_bien(npoints, maxiter):
    # VERSION CORRECTA: reduction(+:num_outside) crea una copia privada por
    # hilo y las combina al final. (Alternativa valida: proteger con critical,
    # pero seria mas lento. atomic NO existe en pyomp 0.5.x.)
    num_outside = 0
    with openmp("parallel for private(j, cr, ci, zr, zi, zr2, zi2, it) reduction(+:num_outside)"):
        for i in range(npoints):
            for j in range(npoints):
                cr = -2.0 + 2.5 * (i + 0.5) / npoints
                ci = 1.125 * (j + 0.5) / npoints
                zr = cr
                zi = ci
                for it in range(maxiter):
                    zr2 = zr * zr
                    zi2 = zi * zi
                    if zr2 + zi2 > 4.0:
                        num_outside += 1
                        break
                    zi = 2.0 * zr * zi + ci
                    zr = zr2 - zi2 + cr
    return 2.0 * 2.5 * 1.125 * (npoints * npoints - num_outside) / (npoints * npoints)


NP = 1000
MAXITER = 1000

print("area real aproximada ~ 1.506")
print("con data race (3 corridas, mira como VARIA):")
for _ in range(3):
    print("  area =", area_mandelbrot_mal(NP, MAXITER))
print("con reduction (3 corridas, siempre igual):")
for _ in range(3):
    print("  area =", area_mandelbrot_bien(NP, MAXITER))
