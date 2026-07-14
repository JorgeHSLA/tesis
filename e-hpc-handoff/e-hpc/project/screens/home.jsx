// Home screen — menú principal profesional y amigable

function QuickCard({ icon: Ico, title, desc, cta, onClick, accent }) {
  return (
    <button className="qcard" onClick={onClick} data-accent={accent || ''}>
      <div className="qcard-icon"><Ico size={22} stroke={1.75}/></div>
      <div className="qcard-body">
        <div className="qcard-title">{title}</div>
        <div className="qcard-desc">{desc}</div>
      </div>
      <div className="qcard-cta">
        <span>{cta}</span>
        <IconArrowRight size={14}/>
      </div>
    </button>
  );
}

function HomeScreen({ onNav }) {
  const recent = [
    { id: 1, name: 'heat-diffusion-2d.py', status: 'completed', nodes: 4, time: '2m 14s', when: 'hace 5 min' },
    { id: 2, name: 'matmul-mpi.c', status: 'running', nodes: 8, time: '0m 47s', when: 'ahora' },
    { id: 3, name: 'pagerank-worker-test.py', status: 'failed', nodes: 3, time: '0m 12s', when: 'hace 1 h' },
  ];

  const lessons = [
    { id: 'mpi-101', title: '¿Qué es un cluster HPC?', dur: '8 min', tag: 'Fundamentos' },
    { id: 'slurm', title: 'Tu primer script de Slurm', dur: '12 min', tag: 'Práctico' },
    { id: 'mpi-comm', title: 'Comunicación entre workers', dur: '10 min', tag: 'MPI' },
  ];

  const TUT_STEPS = [
    { icon: IconUpload, title: 'Sube tu código', short: 'Arrastra un archivo y listo.', goto: 'simulator' },
    { icon: IconCluster, title: 'Configura el cluster', short: 'Decide cuántos workers quieres.', goto: 'simulator' },
    { icon: IconPlay, title: 'Ejecuta y aprende', short: 'Observa todo en vivo.', goto: 'simulator' },
  ];

  return (
    <div className="screen home">
      <div className="hero">
        <div className="hero-left">
          <div className="eyebrow">Bienvenido de vuelta</div>
          <h1 className="display-xl">Aprende HPC<br/>sin necesitar un HPC.</h1>
          <p className="hero-sub">
            Simulamos un cluster en tu computadora con contenedores Docker.
            Escribe código, configura nodos, ejecútalo — y aprende por qué funciona (o por qué no).
          </p>
          <div className="row" style={{gap:10, marginTop:20}}>
            <button className="btn btn-primary btn-xl" onClick={() => onNav('simulator')}>
              <IconZap size={18}/> Empezar simulación
            </button>
            <button className="btn btn-outline btn-xl" onClick={() => onNav('learn')}>
              <IconBook size={18}/> Explorar lecciones
            </button>
          </div>
        </div>

        <div className="hero-right">
          <HomeClusterDiagram />
        </div>
      </div>

      {/* Tutorial: cómo funciona E-HPC */}
      <div className="section-head">
        <div>
          <div className="eyebrow">Cómo funciona</div>
          <h2 className="display-lg" style={{marginTop:4}}>3 pasos para simular tu primer cluster</h2>
        </div>
      </div>

      <div className="tutorial-tabs static">
        {TUT_STEPS.map((s, i) => {
          const Ico = s.icon;
          return (
            <button key={i} className="tut-tab active" onClick={() => onNav(s.goto)}>
              <span className="tut-tab-num">{(i+1).toString().padStart(2,'0')}</span>
              <span className="tut-tab-icon"><Ico size={16}/></span>
              <span className="tut-tab-body">
                <span className="tut-tab-title">{s.title}</span>
                <span className="tut-tab-short">{s.short}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="tutorial-callout">
        <div className="tut-callout-icon"><IconHelp size={18}/></div>
        <div style={{flex:1}}>
          <b>¿Primera vez aquí?</b>
          <p style={{margin:'2px 0 0', color:'var(--text-muted)', fontSize:13.5}}>
            Te recomendamos empezar por el tutorial en video <i>"¿Qué es un cluster HPC?"</i> — 8 minutos
            y te da todo el contexto que necesitas para entender qué estás simulando.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => onNav('learn')}>
          <IconPlay size={12}/> Ver tutorial
        </button>
      </div>

      <div className="section-head">
        <div>
          <div className="eyebrow">Acciones rápidas</div>
          <h2 className="display-lg" style={{marginTop:4}}>¿Qué quieres hacer ahora?</h2>
        </div>
      </div>

      <div className="quick-grid">
        <QuickCard icon={IconCluster} title="Configurar un cluster"
                   desc="Define head, workers y reparto de cómputo. Sube tu código para ejecutarlo."
                   cta="Configurar" onClick={() => onNav('simulator')} accent="orange"/>
        <QuickCard icon={IconPlay} title="Ver cluster en vivo"
                   desc="Observa los nodos, métricas CPU/memoria y mensajes MPI en tiempo real."
                   cta="Abrir monitor" onClick={() => onNav('simulator')} accent="green"/>
        <QuickCard icon={IconBook} title="Continuar aprendiendo"
                   desc="Retomas en: Comunicación entre workers. Te faltan 2 quizzes para completar el track."
                   cta="Continuar" onClick={() => onNav('learn')} accent="blue"/>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <IconClock size={16}/>
            <div className="card-title">Jobs recientes</div>
            <div style={{marginLeft:'auto'}}><button className="btn btn-ghost btn-sm" onClick={() => onNav('results')}>Ver todos</button></div>
          </div>
          <div className="recent-list">
            {recent.map(r => (
              <div key={r.id} className="recent-row" onClick={() => onNav('results')}>
                <div className="recent-icon">
                  {r.status === 'completed' && <IconCheck size={14}/>}
                  {r.status === 'running' && <IconPlay size={14}/>}
                  {r.status === 'failed' && <IconAlert size={14}/>}
                </div>
                <div className="recent-name mono">{r.name}</div>
                <span className={'chip ' + (
                  r.status === 'completed' ? 'chip-green'
                  : r.status === 'running' ? 'chip-orange'
                  : 'chip-red'
                )}>{r.status === 'completed' ? 'OK' : r.status === 'running' ? 'EN VIVO' : 'ERROR'}</span>
                <div className="mono-small">{r.nodes} nodos · {r.time}</div>
                <div className="mono-small" style={{marginLeft:'auto'}}>{r.when}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <IconBook size={16}/>
            <div className="card-title">Lecciones sugeridas</div>
          </div>
          <div className="lesson-list">
            {lessons.map(l => (
              <div key={l.id} className="lesson-row" onClick={() => onNav('learn')}>
                <div className="lesson-thumb">
                  <div className="lesson-thumb-play"><IconPlay size={12}/></div>
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div className="lesson-title">{l.title}</div>
                  <div className="mono-small">{l.tag} · {l.dur}</div>
                </div>
                <IconChevronRight size={16} className="muted"/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Animated mini-diagram of a cluster
function HomeClusterDiagram() {
  const [pulse, setPulse] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setPulse(p => (p + 1) % 4), 900);
    return () => clearInterval(t);
  }, []);
  const workers = [
    { x: 70, y: 180 }, { x: 170, y: 180 }, { x: 270, y: 180 }, { x: 370, y: 180 }
  ];
  return (
    <div className="hero-diagram">
      <svg viewBox="0 0 440 260" width="100%" height="100%">
        <defs>
          <linearGradient id="hg-head" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3F7A2E"/>
            <stop offset="1" stopColor="#2F5E21"/>
          </linearGradient>
          <linearGradient id="hg-w" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6BA850"/>
            <stop offset="1" stopColor="#3F7A2E"/>
          </linearGradient>
        </defs>
        {/* Dotted connection lines */}
        {workers.map((w, i) => (
          <path key={i} d={`M220 80 L220 130 L${w.x} 130 L${w.x} 175`}
                fill="none" stroke="#D4C4A0" strokeWidth="1.5" strokeDasharray="3 4"/>
        ))}
        {/* Traveling packets */}
        {workers.map((w, i) => {
          const active = pulse === i;
          return (
            <circle key={'p'+i} r="4" fill="#F57324" opacity={active ? 1 : 0}>
              <animate attributeName="opacity" values="0;1;1;0" dur="0.9s" repeatCount="indefinite" begin={`${i * 0.9}s`}/>
              <animateMotion dur="0.9s" repeatCount="indefinite" begin={`${i * 0.9}s`}
                             path={`M220 80 L220 130 L${w.x} 130 L${w.x} 175`}/>
            </circle>
          );
        })}
        {/* Head node */}
        <g transform="translate(220,60) rotate(45)">
          <rect x="-22" y="-22" width="44" height="44" rx="4" fill="url(#hg-head)"/>
        </g>
        <text x="220" y="35" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#5C4A39">head-node</text>
        {/* Workers */}
        {workers.map((w, i) => (
          <g key={i}>
            <g transform={`translate(${w.x},${w.y}) rotate(45)`}>
              <rect x="-18" y="-18" width="36" height="36" rx="4" fill="url(#hg-w)"/>
            </g>
            <text x={w.x} y={w.y + 42} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#5C4A39">w{i}</text>
          </g>
        ))}
      </svg>
      <div className="hero-diagram-caption">
        <span className="chip chip-orange">MPI_Send</span>
        <span className="mono-small">4 workers · simulando</span>
      </div>
    </div>
  );
}

function TutVisualUpload() {
  return (
    <div className="tut-visual">
      <div className="tut-dz">
        <IconUpload size={32}/>
        <div style={{fontWeight:500, marginTop:8}}>Suelta tu archivo aquí</div>
        <div className="mono-small">.py · .c · .cpp · .sbatch</div>
      </div>
      <div className="tut-file-chip"><IconFile size={12}/> <span className="mono">heat-diffusion-2d.py</span> <span className="chip chip-green" style={{marginLeft:'auto'}}>listo</span></div>
    </div>
  );
}
function TutVisualCluster() {
  return (
    <div className="tut-visual" style={{padding: '20px 10px'}}>
      <HomeClusterDiagram/>
    </div>
  );
}

Object.assign(window, { HomeScreen });