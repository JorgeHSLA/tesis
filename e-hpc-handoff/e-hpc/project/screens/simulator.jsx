// Unified Simulator — configure & run in the same screen.
// status: 'idle' | 'running' | 'finished'

function SimulatorScreen({ config, setConfig, status, setStatus, onViewResults }) {
  const isIdle = status === 'idle';
  const isRunning = status === 'running';

  return (
    <div className="screen simulator-screen">
      <SimulatorHeader status={status} setStatus={setStatus}
                       config={config} onViewResults={onViewResults}/>

      {isIdle && <SimulatorIdleBody config={config} setConfig={setConfig}/>}
      {!isIdle && <SimulatorLiveBody config={config} status={status} setStatus={setStatus}/>}
    </div>
  );
}

function SimulatorHeader({ status, setStatus, config, onViewResults }) {
  const launch = () => setStatus('running');
  const stop = () => setStatus('idle');
  const [paused, setPaused] = React.useState(false);

  if (status === 'idle') {
    return (
      <div className="screen-head">
        <div>
          <div className="eyebrow">Simulador</div>
          <h2 className="display-lg">Configura y lanza tu cluster</h2>
          <p className="muted" style={{margin:'6px 0 0', maxWidth: 640}}>
            Define tu topología, sube tu código y pulsa <b>Lanzar simulación</b> para ver cómo se ejecuta en vivo.
            Cada nodo es un contenedor Docker en tu máquina.
          </p>
        </div>
        <div className="row">
          <button className="btn btn-outline">Cargar preset</button>
          <button className="btn btn-primary btn-lg" onClick={launch}>
            <IconPlay size={14}/> Lanzar simulación
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-head">
      <div>
        <div className="eyebrow">Ejecución en vivo</div>
        <h2 className="display-lg">{config.codeFile || 'heat-diffusion-2d.py'}</h2>
        <div className="row" style={{gap:8, marginTop:6}}>
          <span className="chip chip-orange">
            <span className="status-dot" style={{background:'var(--orange-500)'}}></span>
            {status === 'finished' ? 'Finalizado' : paused ? 'En pausa' : 'Ejecutando'}
          </span>
          <span className="mono-small">job #a3f9c2 · {config.workers} workers · {config.framework}</span>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-outline" onClick={() => setPaused(p => !p)}>
          {paused ? <><IconPlay size={14}/> Reanudar</> : <><IconPause size={14}/> Pausar</>}
        </button>
        <button className="btn btn-outline" onClick={stop}>
          <IconStop size={14}/> Detener
        </button>
        <button className="btn btn-primary" onClick={onViewResults}>
          Ver resultados <IconArrowRight size={14}/>
        </button>
      </div>
    </div>
  );
}

/* ----------------- IDLE (config) ----------------- */

function SimulatorIdleBody({ config, setConfig }) {
  const workerPct = config.workerPct;
  const headPct = config.headPct;
  const total = workerPct * config.workers + headPct;

  const updateFile = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => setConfig(c => ({ ...c, codeFile: file.name, code: ev.target.result }));
      reader.readAsText(file);
    }
  };

  return (
    <>
      <div className="config-grid">
        <div className="card code-upload">
          <div className="card-head">
            <IconCode size={16}/>
            <div className="card-title">Tu código</div>
            <div className="card-sub" style={{marginLeft:'auto'}}>{config.codeFile || 'sin archivo'}</div>
          </div>
          <div className="code-upload-body">
            <label className="dropzone">
              <input type="file" accept=".py,.c,.cpp,.f90,.sh,.sbatch" onChange={updateFile} style={{display:'none'}}/>
              <IconUpload size={22}/>
              <div className="dz-title">Arrastra tu archivo aquí</div>
              <div className="dz-sub mono-small">.py · .c · .cpp · .sh · .sbatch</div>
              <button className="btn btn-outline btn-sm" style={{marginTop:10}} onClick={(e) => e.preventDefault()}>
                O selecciónalo
              </button>
            </label>
            <div className="code-preview">
              <div className="code-preview-head">
                <span className="mono-small">{config.codeFile || 'heat-diffusion-2d.py'}</span>
                <span className="chip chip-orange">Slurm · MPI</span>
              </div>
              <pre className="code-preview-body">{config.code || SAMPLE_CODE}</pre>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <IconCluster size={16}/>
            <div className="card-title">Topología del cluster</div>
          </div>
          <div className="topology-viz">
            <ClusterTopology workers={config.workers} workerPct={config.workerPct} headPct={config.headPct}/>
          </div>

          <div className="config-fields">
            <div className="field">
              <div className="field-row">
                <label className="field-label">Cantidad de workers</label>
                <span className="mono-small">{config.workers} nodos</span>
              </div>
              <input type="range" min="1" max="12" value={config.workers}
                     onChange={e => setConfig(c => ({...c, workers: +e.target.value}))}/>
              <div className="field-hint">Más workers = más paralelismo, pero también más overhead de comunicación.</div>
            </div>

            <div className="field">
              <div className="field-row">
                <label className="field-label">% cómputo por worker</label>
                <span className="mono-small">{config.workerPct}%</span>
              </div>
              <input type="range" min="5" max="50" value={config.workerPct}
                     onChange={e => setConfig(c => ({...c, workerPct: +e.target.value}))}/>
            </div>

            <div className="field">
              <div className="field-row">
                <label className="field-label">% cómputo del head</label>
                <span className="mono-small">{config.headPct}%</span>
              </div>
              <input type="range" min="5" max="40" value={config.headPct}
                     onChange={e => setConfig(c => ({...c, headPct: +e.target.value}))}/>
            </div>

            <div className={'allocation-bar ' + (total > 100 ? 'over' : '')}>
              <div className="alloc-segment head" style={{width: Math.min(headPct, 100) + '%'}}>head {headPct}%</div>
              {Array.from({length: config.workers}).map((_, i) => (
                <div key={i} className="alloc-segment worker"
                     style={{width: Math.min(workerPct, 100) + '%'}}>w{i}</div>
              ))}
            </div>
            <div className="row" style={{justifyContent:'space-between'}}>
              <span className="mono-small">Asignación total</span>
              <span className={'chip ' + (total > 100 ? 'chip-red' : total > 85 ? 'chip-amber' : 'chip-green')}>
                {total}% del host
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:20}}>
        <div className="card-head">
          <IconSettings size={16}/>
          <div className="card-title">Opciones avanzadas</div>
        </div>
        <div className="adv-grid">
          <div>
            <label className="field-label">Framework</label>
            <select className="select" value={config.framework}
                    onChange={e => setConfig(c => ({...c, framework: e.target.value}))}>
              <option>Slurm (sbatch)</option>
              <option>MPI (mpirun)</option>
              <option>Python · mpi4py</option>
              <option>OpenMP</option>
            </select>
          </div>
          <div>
            <label className="field-label">Imagen base</label>
            <select className="select">
              <option>ubuntu:22.04 + openmpi</option>
              <option>rockylinux:9 + slurm</option>
              <option>python:3.11 + mpi4py</option>
            </select>
          </div>
          <div>
            <label className="field-label">Timeout</label>
            <input className="input" defaultValue="10 min"/>
          </div>
        </div>
      </div>
    </>
  );
}

/* ----------------- LIVE (running) ----------------- */

function SimulatorLiveBody({ config, status, setStatus }) {
  const [tick, setTick] = React.useState(0);
  const [logs, setLogs] = React.useState([]);
  const [nodeStats, setNodeStats] = React.useState([]);
  const [elapsed, setElapsed] = React.useState(0);
  const progress = Math.min(100, tick * 2);

  // Reset when entering running
  React.useEffect(() => {
    setTick(0); setLogs([]); setElapsed(0);
    setNodeStats(Array.from({length: config.workers + 1}).map((_, i) => ({
      id: i === 0 ? 'head' : `w${i-1}`,
      isHead: i === 0,
      cpu: i === 0 ? 15 : 70 + Math.random() * 20,
      mem: i === 0 ? 20 : 40 + Math.random() * 30,
      msgs: 0,
      status: 'running',
    })));
  }, [config.workers, status]);

  React.useEffect(() => {
    if (progress >= 100) return;
    const t = setInterval(() => {
      setTick(t => t + 1);
      setElapsed(e => e + 1);
      setNodeStats(stats => stats.map((n, i) => {
        const jitter = (v, j) => Math.max(5, Math.min(98, v + (Math.random() - 0.5) * j));
        const idle = i === 3 && tick > 8;
        return {
          ...n,
          cpu: idle ? jitter(n.cpu * 0.3, 5) : jitter(n.cpu, 8),
          mem: jitter(n.mem, 3),
          msgs: n.msgs + (idle ? 0 : Math.round(Math.random() * 12)),
          status: idle ? 'warning' : 'running',
        };
      }));
      setLogs(l => [...l, genLogLine(tick, config.workers)].slice(-40));
    }, 700);
    return () => clearInterval(t);
  }, [progress, tick, config.workers]);

  const fmtTime = (s) => `${Math.floor(s*0.7 / 60)}m ${Math.floor((s*0.7) % 60).toString().padStart(2,'0')}s`;

  return (
    <>
      <div className="metrics-row">
        <MetricCard icon={IconClock} label="Tiempo transcurrido" value={fmtTime(elapsed)} hint={`de ~${fmtTime(50)} estimado`}/>
        <MetricCard icon={IconCpu} label="Progreso" value={`${progress}%`} progress={progress}/>
        <MetricCard icon={IconNet} label="Mensajes MPI" value={nodeStats.reduce((a,n) => a + n.msgs, 0).toLocaleString()} hint="MPI_Send + MPI_Recv"/>
        <MetricCard icon={IconZap} label="Speedup estimado" value={`${(1 + config.workers * 0.7).toFixed(1)}×`} hint="vs 1 nodo"/>
      </div>

      <div className="running-grid">
        <div className="card">
          <div className="card-head">
            <IconCluster size={16}/>
            <div className="card-title">Nodos en vivo</div>
            <div style={{marginLeft:'auto'}} className="mono-small">docker ps · {nodeStats.length} contenedores</div>
          </div>
          <LiveTopology nodes={nodeStats} tick={tick}/>
          {nodeStats.some(n => n.status === 'warning') && (
            <div className="warn-banner">
              <IconAlert size={16}/>
              <div>
                <b>Worker <code className="mono">w3</code> está idle.</b> Su CPU cayó por debajo del 25%.
                Puede ser un bug en la partición de datos — revisa el <code className="mono">MPI_Scatter</code>.
              </div>
              <button className="btn btn-sm btn-outline">Ver en código</button>
            </div>
          )}
        </div>

        <div className="card terminal-card">
          <div className="terminal">
            <div className="terminal-header">
              <span className="terminal-dot" style={{background:'#E85A3A'}}></span>
              <span className="terminal-dot" style={{background:'#E8A317'}}></span>
              <span className="terminal-dot" style={{background:'#6BA850'}}></span>
              <span style={{marginLeft:8}}>docker logs -f head-node --tail 40</span>
            </div>
            <div className="terminal-body" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
              {logs.length === 0 && <div className="term-dim term-line">Iniciando contenedores...</div>}
              {logs.map((l, i) => (
                <div key={i} className="term-line">
                  <span className="term-dim">[{l.time}]</span>{' '}
                  <span className={'term-' + l.color}>{l.tag}</span>{' '}
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:20}}>
        <div className="card-head">
          <IconLayers size={16}/>
          <div className="card-title">Detalle por nodo</div>
        </div>
        <div className="node-table">
          <div className="node-table-head">
            <div>Nodo</div>
            <div>Contenedor</div>
            <div>CPU</div>
            <div>Memoria</div>
            <div>Msgs MPI</div>
            <div>Estado</div>
          </div>
          {nodeStats.map(n => (
            <div key={n.id} className={'node-row ' + (n.status === 'warning' ? 'warn' : '')}>
              <div className="row" style={{gap:8}}>
                <NodeDiamond head={n.isHead} warn={n.status === 'warning'}/>
                <span className="mono">{n.id}</span>
              </div>
              <div className="mono-small">{n.isHead ? 'ehpc-head-01' : `ehpc-worker-${n.id}`}</div>
              <div><MiniBar value={n.cpu} color={n.status === 'warning' ? '#E8A317' : '#3F7A2E'}/></div>
              <div><MiniBar value={n.mem} color="#F57324"/></div>
              <div className="mono">{n.msgs.toLocaleString()}</div>
              <div>
                {n.status === 'warning'
                  ? <span className="chip chip-amber">idle</span>
                  : <span className="chip chip-green">activo</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { SimulatorScreen });
