# de que trata? 

este ejemplo es como si fuera el primer hello world de python o de cualquier otro lenguaje, ademas que es le primer ejemplo que aparece en el video de la presentacion de PyOMP (lo que nos permite usar openMP en python).

video: 

https://www.youtube.com/watch?v=MLkZGEMpriY

## EXPLICACION

@njit = "no ejecutes esta función como Python normal, compílala a código máquina nativo antes de correrla", esto da eficiencia, lo que correo no lo va a correr en si el python, lo que lo hace perfecto para evaluar rendimientos

def hello():  = es la funcion de python de  toda la vida

with openmp("parallel"):  El bloque with marca el inicio y el fin de una región paralela.

print("Hello from thread", omp_get_thread_num()) = lo que va a hacer dentro de cada hilo en paralelo


## detalles

tantos hilos como procesadores lógicos vea el sistema es como se va a usar el . o se puede controlar con la variable de entorno OMP_NUM_THREADS

esto que quiere decir?? que se va a separar en tatnos hilos como los que muestra nproc (procesadores logicos)

ejemplo: 

(.venv) jorsi@jorge:/mnt/d/universidad/tesis/simuladores/openmp/helloWorld$ nproc
8

asi que el codigo va a tener un output de :

(.venv) jorsi@jorge:/mnt/d/universidad/tesis/simuladores/openmp/helloWorld$ python3 helloMPI.py 
Hello from thread 0
Hello from thread 3
Hello from thread 6
Hello from thread 2
Hello from thread 1
Hello from thread 4
Hello from thread 7
Hello from thread 5
