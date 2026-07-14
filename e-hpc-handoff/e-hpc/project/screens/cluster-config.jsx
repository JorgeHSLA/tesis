// Cluster configuration screen

function ClusterConfigScreen({ config, setConfig, onLaunch }) {
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
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Paso 1 de 3</div>
          <h2 className="display-lg">Configura tu cluster</h2>
          <p className="muted" style={{margin:'6px 0 0', maxWidth: 620}}>
            Define cuántos workers quieres y cuánto cómputo asignar. Cada nodo es un contenedor Docker en tu máquina.
          </p>
        </div>
        <div className="row">
          <button className="btn btn-outline">Cargar preset</button>
          <button className="btn btn-primary" onClick={onLaunch}>
            <IconPlay size={14}/> Lanzar simulación
          </button>
        </div>
      </div>

      <div className="config-grid">
        {/* Left: code upload */}
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

        {/* Right: cluster topology */}
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

      {/* Advanced */}
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
    </div>
  );
}

function ClusterTopology({ workers, workerPct, headPct }) {
  const width = 560, height = 200;
  const spacing = Math.min(80, (width - 80) / workers);
  const startX = width/2 - ((workers - 1) * spacing) / 2;
  const headX = width/2, headY = 40;
  const wy = 140;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="200">
      <defs>
        <linearGradient id="tg-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3F7A2E"/>
          <stop offset="1" stopColor="#2F5E21"/>
        </linearGradient>
        <linearGradient id="tg-w" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6BA850"/>
          <stop offset="1" stopColor="#3F7A2E"/>
        </linearGradient>
      </defs>
      {Array.from({length: workers}).map((_, i) => {
        const x = startX + i * spacing;
        return (
          <path key={i} d={`M${headX} ${headY + 22} L${headX} ${wy - 40} L${x} ${wy - 40} L${x} ${wy - 18}`}
                fill="none" stroke="#D4C4A0" strokeWidth="1.2" strokeDasharray="3 3"/>
        );
      })}
      {/* Head */}
      <g transform={`translate(${headX},${headY}) rotate(45)`}>
        <rect x="-20" y="-20" width="40" height="40" rx="4" fill="url(#tg-h)"/>
      </g>
      <text x={headX} y={headY - 26} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#5C4A39">head · {headPct}%</text>
      {/* Workers */}
      {Array.from({length: workers}).map((_, i) => {
        const x = startX + i * spacing;
        const size = 14 + (workerPct / 50) * 8;
        return (
          <g key={i}>
            <g transform={`translate(${x},${wy}) rotate(45)`}>
              <rect x={-size} y={-size} width={size*2} height={size*2} rx="3" fill="url(#tg-w)"/>
            </g>
            <text x={x} y={wy + 34} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="#5C4A39">w{i}</text>
            <text x={x} y={wy + 46} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="#A08B6E">{workerPct}%</text>
          </g>
        );
      })}
    </svg>
  );
}

const SAMPLE_CODE = `#!/usr/bin/env python3
# heat-diffusion-2d.py — ejemplo MPI
from mpi4py import MPI
import numpy as np

comm = MPI.COMM_WORLD
rank = comm.Get_rank()
size = comm.Get_size()

N = 512
local_N = N // size
u = np.zeros((local_N + 2, N))

for step in range(1000):
    # exchange ghost rows with neighbors
    if rank > 0:
        comm.Send(u[1], dest=rank-1)
        comm.Recv(u[0], source=rank-1)
    if rank < size - 1:
        comm.Send(u[-2], dest=rank+1)
        comm.Recv(u[-1], source=rank+1)
    # update interior
    u[1:-1] = 0.25 * (u[:-2] + u[2:] + np.roll(u[1:-1], 1, 1) + np.roll(u[1:-1], -1, 1))`;

Object.assign(window, { ClusterConfigScreen });
