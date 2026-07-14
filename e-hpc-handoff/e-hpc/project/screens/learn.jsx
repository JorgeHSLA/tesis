// Learn screen — Coursera/Udemy style

function LearnScreen({ lessonId = 'mpi-comm', onBackToCatalog }) {
  const [current, setCurrent] = React.useState(lessonId);
  const [descOpen, setDescOpen] = React.useState(true);
  const [moduleOpen, setModuleOpen] = React.useState(true);

  React.useEffect(() => { setCurrent(lessonId); }, [lessonId]);

  const tracks = [
    { id: 'fund', title: 'Fundamentos de HPC', progress: 80, lessons: 6 },
    { id: 'mpi',  title: 'MPI desde cero', progress: 45, lessons: 10 },
    { id: 'slurm',title: 'Slurm y scheduling', progress: 20, lessons: 7 },
  ];

  const sidebar = [
    { id: 'intro',    type: 'video', title: '¿Qué es MPI?', dur: '6:32', done: true },
    { id: 'hello',    type: 'video', title: 'Hello world con MPI', dur: '7:18', done: true },
    { id: 'ranks',    type: 'video', title: 'Ranks, size y comunicadores', dur: '9:05', done: true },
    { id: 'mpi-comm', type: 'video', title: 'Comunicación entre workers', dur: '10:14', done: false },
    { id: 'mpi-quiz', type: 'quiz',  title: 'Quiz: MPI_Send vs MPI_Isend', q: 5, done: false },
    { id: 'collect',  type: 'video', title: 'Operaciones colectivas', dur: '14:22', done: false },
    { id: 'barrier',  type: 'video', title: 'Barriers y sincronización', dur: '8:03', done: false },
    { id: 'deadlock', type: 'video', title: 'Deadlocks y cómo evitarlos', dur: '12:47', done: false },
    { id: 'q-col',    type: 'quiz',  title: 'Quiz final del módulo', q: 8, done: false },
  ];

  return (
    <div className="screen learn">
      <div className="screen-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBackToCatalog}
                  style={{marginBottom:10, paddingLeft:6}}>
            <IconChevronLeft size={14}/> Volver al catálogo
          </button>
          <div className="eyebrow">ZINE · Aprender</div>
          <h2 className="display-lg">Comunicación entre workers</h2>
          <div className="row" style={{gap:8, marginTop:6}}>
            <span className="chip chip-orange">MPI desde cero</span>
            <span className="chip">Módulo 3 · Lección 2</span>
            <span className="mono-small">Progreso: 4/10</span>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-outline"><IconChevronLeft size={14}/> Anterior</button>
          <button className="btn btn-primary">Siguiente <IconChevronRight size={14}/></button>
        </div>
      </div>

      <div className="learn-grid">
        {/* Main: video + content */}
        <div className="col" style={{gap:20}}>
          <div className="video-player">
            <div className="video-screen">
              <svg viewBox="0 0 200 120" width="100%" height="100%" style={{position:'absolute', inset:0}}>
                <defs>
                  <linearGradient id="vbg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#1F1913"/>
                    <stop offset="1" stopColor="#3D3125"/>
                  </linearGradient>
                </defs>
                <rect width="200" height="120" fill="url(#vbg)"/>
                {/* illustration: head + 2 workers sending messages */}
                <g transform="translate(100,35) rotate(45)"><rect x="-9" y="-9" width="18" height="18" rx="2" fill="#6BA850"/></g>
                <g transform="translate(60,85) rotate(45)"><rect x="-8" y="-8" width="16" height="16" rx="2" fill="#F57324"/></g>
                <g transform="translate(140,85) rotate(45)"><rect x="-8" y="-8" width="16" height="16" rx="2" fill="#F57324"/></g>
                <path d="M100 50 L60 75" stroke="#F9EFD9" strokeWidth="0.6" strokeDasharray="2 2" opacity=".5"/>
                <path d="M100 50 L140 75" stroke="#F9EFD9" strokeWidth="0.6" strokeDasharray="2 2" opacity=".5"/>
                <text x="100" y="110" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="6" fill="#F9EFD9" opacity=".7">MPI_Send / MPI_Recv</text>
              </svg>
              <button className="video-play-btn" aria-label="Play">
                <IconPlay size={28}/>
              </button>
            </div>
            <div className="video-controls">
              <div className="video-scrubber"><div className="video-scrubber-fill"></div><div className="video-scrubber-dot"></div></div>
              <div className="row" style={{justifyContent:'space-between', marginTop:8}}>
                <div className="row" style={{gap:10}}>
                  <button className="btn btn-ghost btn-sm"><IconPlay size={14}/></button>
                  <span className="mono-small">3:42 / 10:14</span>
                </div>
                <div className="row" style={{gap:6}}>
                  <button className="btn btn-ghost btn-sm">1×</button>
                  <button className="btn btn-ghost btn-sm">CC</button>
                  <button className="btn btn-ghost btn-sm">⛶</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <button className={'collapse-head ' + (descOpen ? 'open' : '')}
                    onClick={() => setDescOpen(o => !o)}>
              <IconChevronRight size={16} className="collapse-chev"/>
              <h3 className="display-md" style={{margin:0, flex:1, textAlign:'left'}}>De qué va esta lección</h3>
              <span className="mono-small">{descOpen ? 'ocultar' : 'mostrar'}</span>
            </button>
            {descOpen && (
            <div className="card-pad" style={{paddingTop:0}}>
              <p style={{marginTop:0, color:'var(--text-muted)'}}>
                Cuando varios workers colaboran en un cálculo, necesitan intercambiar información.
                En MPI las dos primitivas básicas son <code className="mono">MPI_Send</code> y <code className="mono">MPI_Recv</code>.
                En esta lección verás cuándo usar cada una, por qué <code className="mono">MPI_Send</code> puede bloquear tu programa, y
                cómo evitarlo con versiones no-bloqueantes (<code className="mono">MPI_Isend</code>).
              </p>

              <div className="tabs">
                <button className="tab active">Descripción</button>
                <button className="tab">Código ejemplo</button>
                <button className="tab">Recursos</button>
                <button className="tab">Transcripción</button>
              </div>

              <div className="takeaways">
                <div className="takeaway-title">Lo que vas a aprender</div>
                <ul>
                  <li><IconCheck size={14}/> La diferencia entre comunicación <i>point-to-point</i> y <i>colectiva</i>.</li>
                  <li><IconCheck size={14}/> Por qué <code className="mono">MPI_Send</code> puede causar deadlocks.</li>
                  <li><IconCheck size={14}/> Cuándo usar <code className="mono">MPI_Isend/Irecv</code> + <code className="mono">MPI_Wait</code>.</li>
                  <li><IconCheck size={14}/> Cómo depurar mensajes usando el simulador local de E-HPC.</li>
                </ul>
              </div>

              <div className="row" style={{marginTop:18, gap:10}}>
                <button className="btn btn-primary"><IconPlay size={14}/> Probar en el simulador</button>
                <button className="btn btn-outline"><IconDownload size={14}/> Slides (PDF)</button>
              </div>
            </div>
            )}
          </div>

          {/* Quiz teaser */}
          <div className="card quiz-teaser">
            <div className="row" style={{alignItems:'flex-start', gap:16}}>
              <div className="quiz-badge"><IconHelp size={20}/></div>
              <div style={{flex:1}}>
                <div className="eyebrow">Pon a prueba</div>
                <h3 className="display-md" style={{margin:'2px 0 4px'}}>¿Listo para el quiz?</h3>
                <p className="muted" style={{margin:0}}>5 preguntas rápidas sobre MPI_Send vs MPI_Isend.</p>
              </div>
              <button className="btn btn-primary">Empezar quiz <IconArrowRight size={14}/></button>
            </div>
          </div>
        </div>

        {/* Right sidebar: track + recommendations */}
        <div className="col learn-side" style={{gap:16}}>
          <div className="card module-card">
            <button className={'module-head module-head-btn ' + (moduleOpen ? 'open' : '')}
                    onClick={() => setModuleOpen(o => !o)}>
              <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                <div className="module-eyebrow">
                  <IconLayers size={12}/>
                  <span>Módulo 3 · 10 lecciones</span>
                </div>
                <h3 className="module-title">MPI desde cero</h3>
                <div className="module-progress-row">
                  <div className="module-progress-bar">
                    <div style={{width: '45%'}}></div>
                  </div>
                  <span className="mono-small">4/10</span>
                </div>
              </div>
              <IconChevronRight size={18} className="module-chev"/>
            </button>
            {moduleOpen && (
              <div className="lesson-sidebar">
                {sidebar.map((l, i) => (
                  <button key={l.id}
                          className={'lesson-side ' + (l.id === current ? 'current' : '') + (l.done ? ' done' : '')}
                          onClick={() => setCurrent(l.id)}>
                    <span className="lesson-num-badge">
                      {l.done
                        ? <IconCheck size={11}/>
                        : <span className="mono">{(i+1).toString().padStart(2,'0')}</span>}
                    </span>
                    <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                      <div className="lesson-side-title">{l.title}</div>
                      <div className="lesson-side-meta mono-small">
                        {l.type === 'video'
                          ? <><IconPlay size={9}/> {l.dur}</>
                          : <><IconHelp size={9}/> {l.q} preguntas</>}
                      </div>
                    </div>
                    {l.id === current && <span className="now-dot"></span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card reco-card">
            <div className="reco-head">
              <div className="reco-eyebrow">
                <IconBook size={12}/>
                <span>Recomendado para ti</span>
              </div>
              <h3 className="reco-title">Sigue explorando</h3>
            </div>
            <div className="reco-list">
              {[
                { t: 'Deadlocks clásicos en MPI', meta: '8 min', tag: 'Intermedio', kind: 'video' },
                { t: 'Simular un cluster de 16 nodos', meta: 'Reto práctico', tag: 'Práctica', kind: 'challenge' },
                { t: 'Slurm: tu primer sbatch', meta: '12 min', tag: 'Fundamentos', kind: 'video' },
              ].map((r, i) => (
                <button key={i} className="reco-item">
                  <span className={'reco-thumb reco-' + r.kind}>
                    {r.kind === 'video' ? <IconPlay size={13}/> : <IconZap size={13}/>}
                  </span>
                  <div style={{flex:1, minWidth:0, textAlign:'left'}}>
                    <div className="reco-item-title">{r.t}</div>
                    <div className="reco-item-meta">
                      <span className={'reco-tag reco-tag-' + r.tag.toLowerCase()}>{r.tag}</span>
                      <span className="mono-small">·</span>
                      <span className="mono-small">{r.meta}</span>
                    </div>
                  </div>
                  <IconChevronRight size={14} className="muted"/>
                </button>
              ))}
            </div>
          </div>

          <div className="card tracks-card">
            <div className="card-pad">
              <div className="eyebrow">Tu progreso</div>
              {tracks.map(t => (
                <div key={t.id} className="track-row">
                  <div className="row" style={{justifyContent:'space-between'}}>
                    <div style={{fontWeight:500, fontSize:14}}>{t.title}</div>
                    <span className="mono-small">{t.progress}%</span>
                  </div>
                  <div className="track-bar"><div style={{width: t.progress + '%'}}></div></div>
                  <div className="mono-small">{Math.round(t.lessons * t.progress/100)} de {t.lessons} lecciones</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LearnScreen });
