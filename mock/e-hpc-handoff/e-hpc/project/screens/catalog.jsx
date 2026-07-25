// Catalog screen — index of all modules / videos / quizzes before entering player

function CatalogScreen({ onOpenLesson }) {
  const [filter, setFilter] = React.useState('all'); // all | video | quiz
  const [query, setQuery] = React.useState('');
  const [openMod, setOpenMod] = React.useState('mpi'); // only one open at a time

  const modules = [
    {
      id: 'fund',
      n: '01',
      title: 'Fundamentos de HPC',
      desc: 'Qué es un cluster, head vs workers, paralelismo de datos vs tareas.',
      level: 'Principiante',
      duration: '1h 12m',
      progress: 80,
      lessons: [
        { id: 'f1', type: 'video', title: '¿Qué es HPC y por qué importa?', dur: '8:20', done: true },
        { id: 'f2', type: 'video', title: 'Anatomía de un cluster', dur: '10:04', done: true },
        { id: 'f3', type: 'video', title: 'Paralelismo: datos vs tareas', dur: '11:30', done: true },
        { id: 'f4', type: 'video', title: 'Speedup y ley de Amdahl', dur: '9:45', done: true },
        { id: 'f5', type: 'quiz',  title: 'Quiz: conceptos básicos', q: 6, done: true },
        { id: 'f6', type: 'video', title: 'Tu primer job en E-HPC', dur: '12:40', done: false },
      ],
    },
    {
      id: 'mpi',
      n: '02',
      title: 'MPI desde cero',
      desc: 'Message Passing Interface: comunicación entre procesos distribuidos.',
      level: 'Intermedio',
      duration: '1h 58m',
      progress: 45,
      lessons: [
        { id: 'm1', type: 'video', title: '¿Qué es MPI?', dur: '6:32', done: true },
        { id: 'm2', type: 'video', title: 'Hello world con MPI', dur: '7:18', done: true },
        { id: 'm3', type: 'video', title: 'Ranks, size y comunicadores', dur: '9:05', done: true },
        { id: 'mpi-comm', type: 'video', title: 'Comunicación entre workers', dur: '10:14', done: false, current: true },
        { id: 'm5', type: 'quiz',  title: 'Quiz: MPI_Send vs MPI_Isend', q: 5, done: false },
        { id: 'm6', type: 'video', title: 'Operaciones colectivas', dur: '14:22', done: false },
        { id: 'm7', type: 'video', title: 'Barriers y sincronización', dur: '8:03', done: false },
        { id: 'm8', type: 'video', title: 'Deadlocks y cómo evitarlos', dur: '12:47', done: false },
        { id: 'm9', type: 'quiz',  title: 'Quiz final del módulo', q: 8, done: false },
        { id: 'm10', type: 'video', title: 'Proyecto: cálculo de π en paralelo', dur: '18:20', done: false },
      ],
    },
    {
      id: 'slurm',
      n: '03',
      title: 'Slurm y scheduling',
      desc: 'El planificador de trabajos más usado en HPC. sbatch, srun, squeue.',
      level: 'Intermedio',
      duration: '1h 34m',
      progress: 20,
      lessons: [
        { id: 's1', type: 'video', title: 'Introducción a Slurm', dur: '7:44', done: true },
        { id: 's2', type: 'video', title: 'Tu primer sbatch', dur: '12:10', done: false },
        { id: 's3', type: 'video', title: 'Recursos: --ntasks, --cpus, --mem', dur: '11:08', done: false },
        { id: 's4', type: 'video', title: 'Arrays de jobs', dur: '9:55', done: false },
        { id: 's5', type: 'quiz',  title: 'Quiz: sbatch scripts', q: 7, done: false },
        { id: 's6', type: 'video', title: 'Prioridades y colas', dur: '13:22', done: false },
        { id: 's7', type: 'video', title: 'Debug: cuando un job falla', dur: '10:18', done: false },
      ],
    },
    {
      id: 'debug',
      n: '04',
      title: 'Debugging y profiling',
      desc: 'Encontrar cuellos de botella, race conditions y errores en código paralelo.',
      level: 'Avanzado',
      duration: '1h 21m',
      progress: 0,
      lessons: [
        { id: 'd1', type: 'video', title: 'Perfilar con gprof y perf', dur: '14:30', done: false },
        { id: 'd2', type: 'video', title: 'Race conditions en MPI', dur: '11:12', done: false },
        { id: 'd3', type: 'video', title: 'Load balancing visual', dur: '12:05', done: false },
        { id: 'd4', type: 'quiz',  title: 'Quiz: identificar bottlenecks', q: 6, done: false },
        { id: 'd5', type: 'video', title: 'Cuando un worker queda idle', dur: '9:48', done: false },
      ],
    },
  ];

  const totals = modules.reduce((a, m) => ({
    videos: a.videos + m.lessons.filter(l => l.type === 'video').length,
    quizzes: a.quizzes + m.lessons.filter(l => l.type === 'quiz').length,
    done: a.done + m.lessons.filter(l => l.done).length,
    all: a.all + m.lessons.length,
  }), { videos: 0, quizzes: 0, done: 0, all: 0 });

  const matchesFilter = (l) => {
    if (filter !== 'all' && l.type !== filter) return false;
    if (query && !l.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  };

  return (
    <div className="screen catalog">
      <div className="screen-head">
        <div>
          <div className="eyebrow">ZINE · Aprendizaje</div>
          <h2 className="display-lg">Catálogo de contenidos</h2>
          <p className="muted" style={{margin:'6px 0 0', maxWidth:620}}>
            Todos los videos, quizzes y retos prácticos organizados por módulos.
            Elige por dónde empezar o continúa donde lo dejaste.
          </p>
        </div>
        <div className="catalog-continue card">
          <div className="eyebrow">Continuar donde lo dejaste</div>
          <div className="continue-title">Comunicación entre workers</div>
          <div className="continue-meta mono-small">
            <IconLayers size={11}/> MPI desde cero · <IconPlay size={9}/> 10:14
          </div>
          <button className="btn btn-primary btn-sm" style={{marginTop:10}}
                  onClick={() => onOpenLesson('mpi-comm')}>
            <IconPlay size={13}/> Reanudar
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="catalog-stats">
        <div className="cstat"><div className="cstat-n">{totals.done}/{totals.all}</div><div className="cstat-l">Lecciones completadas</div></div>
        <div className="cstat"><div className="cstat-n">{totals.videos}</div><div className="cstat-l">Videos</div></div>
        <div className="cstat"><div className="cstat-n">{totals.quizzes}</div><div className="cstat-l">Quizzes</div></div>
        <div className="cstat"><div className="cstat-n">{modules.length}</div><div className="cstat-l">Módulos</div></div>
      </div>

      {/* Toolbar: search + filters */}
      <div className="catalog-toolbar">
        <div className="catalog-search">
          <IconSearch size={14}/>
          <input type="text" placeholder="Buscar lección, quiz o tema..."
                 value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
        <div className="catalog-filters">
          <button className={'fpill ' + (filter==='all'?'active':'')} onClick={() => setFilter('all')}>
            Todo <span className="fpill-n">{totals.all}</span>
          </button>
          <button className={'fpill ' + (filter==='video'?'active':'')} onClick={() => setFilter('video')}>
            <IconPlay size={11}/> Videos <span className="fpill-n">{totals.videos}</span>
          </button>
          <button className={'fpill ' + (filter==='quiz'?'active':'')} onClick={() => setFilter('quiz')}>
            <IconHelp size={11}/> Quizzes <span className="fpill-n">{totals.quizzes}</span>
          </button>
        </div>
      </div>

      {/* Modules accordion list */}
      <div className="catalog-modules">
        {modules.map(m => {
          const isOpen = openMod === m.id;
          const visible = m.lessons.filter(matchesFilter);
          return (
            <div key={m.id} className={'cat-module card ' + (isOpen ? 'open' : '')}>
              <button className="cat-module-head"
                      onClick={() => setOpenMod(isOpen ? null : m.id)}>
                <div className="cat-module-n mono">{m.n}</div>
                <div className="cat-module-info">
                  <div className="cat-module-title">{m.title}</div>
                  <div className="cat-module-desc">{m.desc}</div>
                  <div className="cat-module-meta">
                    <span className={'level-tag level-' + m.level.toLowerCase()}>{m.level}</span>
                    <span className="mono-small"><IconPlay size={10}/> {m.duration}</span>
                    <span className="mono-small">{m.lessons.length} lecciones</span>
                  </div>
                </div>
                <div className="cat-module-progress">
                  <div className="cat-prog-n mono">{m.progress}%</div>
                  <div className="cat-prog-bar"><div style={{width: m.progress + '%'}}></div></div>
                </div>
                <IconChevronRight size={16} className="cat-module-chev"/>
              </button>

              {isOpen && (
                <div className="cat-lesson-list">
                  {visible.length === 0 && (
                    <div className="cat-empty mono-small">Sin resultados para este filtro.</div>
                  )}
                  {visible.map((l, i) => (
                    <button key={l.id}
                            className={'cat-lesson ' + (l.current ? 'current' : '') + (l.done ? ' done' : '')}
                            onClick={() => onOpenLesson(l.id)}>
                      <span className="cat-lesson-num">
                        {l.done
                          ? <span className="num-badge done"><IconCheck size={11}/></span>
                          : <span className={'num-badge ' + (l.current ? 'current' : '')}>
                              <span className="mono-small">{(i+1).toString().padStart(2,'0')}</span>
                            </span>}
                      </span>
                      <span className={'cat-lesson-icon ' + l.type}>
                        {l.type === 'video' ? <IconPlay size={13}/> : <IconHelp size={13}/>}
                      </span>
                      <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                        <div className="cat-lesson-title">
                          {l.title}
                          {l.current && <span className="chip chip-orange" style={{marginLeft:8, fontSize:10}}>En curso</span>}
                        </div>
                        <div className="cat-lesson-meta mono-small">
                          {l.type === 'video'
                            ? <>Video · {l.dur}</>
                            : <>Quiz · {l.q} preguntas</>}
                          {l.done && <span style={{color:'var(--success)'}}> · Completado</span>}
                        </div>
                      </div>
                      <IconChevronRight size={14} className="muted"/>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { CatalogScreen });
