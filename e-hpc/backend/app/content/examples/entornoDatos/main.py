from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num


@njit
def entorno_datos():
    x = 100    # sera PRIVATE: cada hilo tendra su copia SIN inicializar
    zfp = 10   # sera FIRSTPRIVATE: cada hilo tendra su copia inicializada en 10
    zsh = 0    # sera SHARED: una sola variable compartida entre todos

    with openmp("parallel private(x, tid) firstprivate(zfp) shared(zsh) num_threads(4)"):
        tid = omp_get_thread_num()
        x = tid * 1000        # escribe en SU copia privada, no afecta a nadie
        zfp = zfp + tid       # arranca en 10 en cada hilo -> 10 + tid
        with openmp("critical"):
            zsh += 1          # variable compartida: hay que proteger la suma
        with openmp("barrier"):
            pass              # nadie pasa de aqui hasta que TODOS llegaron
        with openmp("single"):
            # esto lo ejecuta UN SOLO hilo (cualquiera)
            print("[single] ya llegaron todos, zsh =", zsh)
        print("hilo", tid, "-> x privada =", x, "| zfp firstprivate =", zfp)

    print("despues de la region: x =", x, "| zfp =", zfp, "| zsh =", zsh)


entorno_datos()
