// Cluster running — live view of the simulated cluster

function RunningScreen({ config, onFinish }) {
  const [tick, setTick] = React.useState(0);
  const [logs, setLogs] = React.useState([]);
  const [nodeStats, setNodeStats] = React.useState([]);
  const [paused, setPaused] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const progress = Math.min(100, tick * 2);

  // Initialize node stats
  React.useEffect(() => {
    setNodeStats(Array.from({length: config.workers + 1}).map((_, i) => ({
      id: i === 0 ? 'head' : `w${i-1}`,
      isHead: i === 0,
      cpu: i === 0 ? 15 : 70 + Math.random() * 20,
      mem: i === 0 ? 20 : 40 + Math.random() * 30,
      msgs: 0,
      status: 'running',
    })));
  }, [config.workers]);

  // Tick simulation
  React.useEffect(() => {
    if (paused || progress >= 100) return;
    const t = setInterval(() => {
      setTick(t => t + 1);
      setElapsed(e => e + 1);
      setNodeStats(stats => stats.map((n, i) => {
        const jitter = (v, j) => Math.max(5, Math.min(98, v + (Math.random() - 0.5) * j));
        // Simulate one idle worker (warning)
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
  }, [paused, progress, tick, config.workers]);

  const fmtTime = (s) => `${Math.floor(s*0.7 / 60)}m ${Math.floor((s*0.7) % 60).toString().padStart(2,'0')}s`;

  return (
    <div className="screen running-screen">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Ejecución en vivo</div>
          <h2 className="display-lg">heat-diffusion-2d.py</h2>
          <div className="row" style={{gap:8, marginTop:6}}>
            <span className="chip chip-orange">
              <span className="status-dot" style={{background:'var(--orange-500)'}}></span>
              {progress >= 100 ? 'Finalizado' : paused ? 'En pausa' : 'Ejecutando'}
            </span>
            <span className="mono-small">job #a3f9c2 · {config.workers} workers · MPI</span>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-outline" onClick={() => setPaused(p => !p)}>
            {paused ? <><IconPlay size={14}/> Reanudar</> : <><IconPause size={14}/> Pausar</>}
          </button>
          <button className="btn btn-outline" onClick={onFinish}>
            <IconStop size={14}/> Detener
          </button>
          <button className="btn btn-primary" onClick={onFinish}>
            Ver resultados <IconArrowRight size={14}/>
          </button>
        </div>
      </div>

      {/* Top metrics row */}
      <div className="metrics-row">
        <MetricCard icon={IconClock} label="Tiempo transcurrido" value={fmtTime(elapsed)} hint={`de ~${fmtTime(50)} estimado`}/>
        <MetricCard icon={IconCpu} label="Progreso" value={`${progress}%`} progress={progress}/>
        <MetricCard icon={IconNet} label="Mensajes MPI" value={nodeStats.reduce((a,n) => a + n.msgs, 0).toLocaleString()} hint="MPI_Send + MPI_Recv"/>
        <MetricCard icon={IconZap} label="Speedup estimado" value={`${(1 + config.workers * 0.7).toFixed(1)}×`} hint="vs 1 nodo"/>
      </div>

      {/* Main: cluster viz + logs */}
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

      {/* Node detail table */}
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
    </div>
  );
}

function MetricCard({ icon: Ico, label, value, hint, progress }) {
  return (
    <div className="metric-card">
      <div className="metric-icon"><Ico size={16}/></div>
      <div style={{flex:1, minWidth:0}}>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {hint && <div className="mono-small">{hint}</div>}
        {progress !== undefined && (
          <div className="metric-progress"><div style={{width: progress + '%'}}></div></div>
        )}
      </div>
    </div>
  );
}

function MiniBar({ value, color }) {
  return (
    <div className="mini-bar">
      <div className="mini-bar-fill" style={{width: value + '%', background: color}}></div>
      <span className="mini-bar-label mono-small">{Math.round(value)}%</span>
    </div>
  );
}

function NodeDiamond({ head, warn, size=18 }) {
  const c = warn ? '#E8A317' : head ? '#2F5E21' : '#3F7A2E';
  return (
    <div style={{width: size, height: size, transform:'rotate(45deg)', background: c, borderRadius: 3, flexShrink:0}}></div>
  );
}

function LiveTopology({ nodes, tick }) {
  if (!nodes.length) return <div style={{height: 260}}></div>;
  const head = nodes[0];
  const workers = nodes.slice(1);
  const width = 800, height = 280;
  const hx = width/2, hy = 60;
  const spacing = Math.min(100, (width - 80) / Math.max(workers.length, 1));
  const startX = width/2 - ((workers.length - 1) * spacing) / 2;
  const wy = 190;

  return (
    <div className="live-topology">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="280">
        <defs>
          <linearGradient id="lg-h" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3F7A2E"/><stop offset="1" stopColor="#2F5E21"/>
          </linearGradient>
          <linearGradient id="lg-w" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6BA850"/><stop offset="1" stopColor="#3F7A2E"/>
          </linearGradient>
          <linearGradient id="lg-warn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E8A317"/><stop offset="1" stopColor="#A56F0A"/>
          </linearGradient>
        </defs>

        {workers.map((w, i) => {
          const x = startX + i * spacing;
          return (
            <path key={i} d={`M${hx} ${hy + 24} L${hx} ${wy - 50} L${x} ${wy - 50} L${x} ${wy - 22}`}
                  fill="none" stroke="#D4C4A0" strokeWidth="1.5" strokeDasharray="3 4"/>
          );
        })}

        {/* Animated packets: head -> worker and back */}
        {workers.map((w, i) => {
          if (w.status === 'warning') return null;
          const x = startX + i * spacing;
          const path = `M${hx} ${hy + 24} L${hx} ${wy - 50} L${x} ${wy - 50} L${x} ${wy - 22}`;
          return (
            <g key={'pk'+i}>
              <circle r="3.5" fill="#F57324">
                <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${i * 0.25}s`} path={path}/>
              </circle>
              <circle r="3" fill="#6BA850">
                <animateMotion dur="1.8s" repeatCount="indefinite" begin={`${i * 0.25 + 0.9}s`} path={path} keyPoints="1;0" keyTimes="0;1"/>
              </circle>
            </g>
          );
        })}

        {/* Head */}
        <g>
          <circle cx={hx} cy={hy} r="38" fill="rgba(63,122,46,0.08)">
            <animate attributeName="r" values="30;42;30" dur="2s" repeatCount="indefinite"/>
          </circle>
          <g transform={`translate(${hx},${hy}) rotate(45)`}>
            <rect x="-22" y="-22" width="44" height="44" rx="5" fill="url(#lg-h)"/>
          </g>
          <text x={hx} y={hy + 5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#F9EFD9" transform={`rotate(0 ${hx} ${hy})`}>head</text>
        </g>
        <text x={hx} y={hy - 32} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="#3D3125">{head.cpu.toFixed(0)}% cpu</text>

        {/* Workers */}
        {workers.map((w, i) => {
          const x = startX + i * spacing;
          const fill = w.status === 'warning' ? 'url(#lg-warn)' : 'url(#lg-w)';
          return (
            <g key={i}>
              <g transform={`translate(${x},${wy}) rotate(45)`}>
                <rect x="-18" y="-18" width="36" height="36" rx="4" fill={fill}/>
              </g>
              <text x={x} y={wy + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="#F9EFD9">{w.id}</text>
              <text x={x} y={wy + 42} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#3D3125">{w.cpu.toFixed(0)}% · {w.msgs}</text>
              {w.status === 'warning' && (
                <g transform={`translate(${x + 16}, ${wy - 16})`}>
                  <circle r="7" fill="#E8A317"/>
                  <text textAnchor="middle" y="3" fontSize="10" fill="white" fontWeight="700">!</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function genLogLine(tick, w) {
  const nodes = ['head', ...Array.from({length: w}).map((_,i) => `w${i}`)];
  const choices = [
    { tag: '[INFO]', color: 'blue', msg: `rank ${Math.floor(Math.random()*w)} entering MPI_Barrier`},
    { tag: '[MPI] ', color: 'green', msg: `MPI_Send(rank=${Math.floor(Math.random()*w)}, count=${64*(1+Math.floor(Math.random()*8))}, dest=${Math.floor(Math.random()*w)})`},
    { tag: '[MPI] ', color: 'green', msg: `MPI_Recv(src=${Math.floor(Math.random()*w)}, tag=${Math.floor(Math.random()*10)}) ok`},
    { tag: '[STEP]', color: 'amber', msg: `iteration ${tick * 4} / 1000  residual=${(0.01/(tick+1)).toFixed(5)}`},
    { tag: '[DOCK]', color: 'orange', msg: `${nodes[Math.floor(Math.random()*nodes.length)]} cpu=${(60+Math.random()*30).toFixed(0)}% mem=${(300+Math.random()*200).toFixed(0)}MB`},
  ];
  const c = choices[Math.floor(Math.random() * choices.length)];
  const time = new Date().toLocaleTimeString('es', { hour12: false });
  return { ...c, time };
}

Object.assign(window, { RunningScreen });
