// Results screen

function ResultsScreen({ config, onNav }) {
  const duration = 47;
  const workers = config.workers || 4;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Job completado</div>
          <h2 className="display-lg">Resultados · heat-diffusion-2d.py</h2>
          <div className="row" style={{gap:8, marginTop:6}}>
            <span className="chip chip-green"><IconCheck size={12}/> Exit 0 · éxito</span>
            <span className="mono-small">job #a3f9c2 · completado en 2m 14s · {workers} workers</span>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-outline"><IconDownload size={14}/> Descargar output</button>
          <button className="btn btn-outline" onClick={() => onNav('simulator')}>Re-ejecutar</button>
          <button className="btn btn-primary" onClick={() => onNav('learn')}>Siguiente lección <IconArrowRight size={14}/></button>
        </div>
      </div>

      <div className="metrics-row">
        <MetricCard icon={IconClock} label="Tiempo total" value="2m 14s" hint={`~${(duration * workers * 0.75).toFixed(0)}s en 1 nodo`}/>
        <MetricCard icon={IconZap} label="Speedup observado" value={`${(workers * 0.78).toFixed(1)}×`} hint={`eficiencia ${(78).toFixed(0)}%`}/>
        <MetricCard icon={IconNet} label="Mensajes MPI" value="14,862" hint="~ 6.6k/s pico"/>
        <MetricCard icon={IconCpu} label="CPU host promedio" value="62%" hint="máx 89% en w1"/>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <IconLayers size={16}/>
            <div className="card-title">Distribución del trabajo</div>
          </div>
          <WorkDistributionChart workers={workers}/>
        </div>

        <div className="card">
          <div className="card-head">
            <IconAlert size={16}/>
            <div className="card-title">Observaciones del simulador</div>
          </div>
          <div className="observations">
            <div className="obs obs-warn">
              <IconAlert size={16}/>
              <div>
                <b>w3 tuvo 24% menos carga que el resto.</b>
                <p>Tu <code className="mono">MPI_Scatter</code> reparte 128 filas entre {workers} workers — el último recibe el resto. En clusters reales esto se nota más.</p>
                <button className="btn btn-sm btn-outline">Ver sugerencia</button>
              </div>
            </div>
            <div className="obs obs-ok">
              <IconCheck size={16}/>
              <div>
                <b>Comunicación balanceada.</b>
                <p>Todos los workers enviaron/recibieron dentro del 10% entre sí — la topología está bien pensada.</p>
              </div>
            </div>
            <div className="obs obs-info">
              <IconZap size={16}/>
              <div>
                <b>Speedup del {(workers * 0.78).toFixed(1)}× es razonable para este tamaño.</b>
                <p>La ley de Amdahl predice ~{(workers * 0.85).toFixed(1)}× para un código con 95% paralelizable.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:20}}>
        <div className="card-head">
          <IconTerminal size={16}/>
          <div className="card-title">Output (stdout · últimas 12 líneas)</div>
          <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}}><IconDownload size={12}/> log completo</button>
        </div>
        <div style={{padding:16}}>
          <div className="terminal">
            <div className="terminal-body">
              {[
                {t:'green', l:'[MPI] Initialized with '+workers+' ranks'},
                {t:'blue',  l:'[head] distributing 512x512 grid...'},
                {t:'amber', l:'[iter 100/1000] residual=1.24e-02'},
                {t:'amber', l:'[iter 500/1000] residual=3.11e-04'},
                {t:'amber', l:'[iter 1000/1000] residual=8.72e-06  converged ✓'},
                {t:'green', l:'[head] gathering results from workers...'},
                {t:'blue',  l:'[head] writing heat_final.npy (1.02 MB)'},
                {t:'green', l:'[MPI] finalized'},
                {t:'dim',   l:''},
                {t:'dim',   l:'real    2m14.032s'},
                {t:'dim',   l:'user    8m47.122s'},
                {t:'dim',   l:'sys     0m09.441s'},
              ].map((ln, i) => (
                <div key={i} className="term-line">
                  <span className={'term-' + ln.t}>{ln.l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkDistributionChart({ workers }) {
  const data = Array.from({length: workers}).map((_, i) => ({
    label: `w${i}`,
    compute: 70 + Math.random() * 20,
    comm: 20 + Math.random() * 15,
    idle: i === 3 ? 25 : 5 + Math.random() * 6,
  }));
  const max = 100;
  return (
    <div style={{padding:'8px 20px 20px'}}>
      <div className="legend-row">
        <span className="lg-dot" style={{background:'#3F7A2E'}}></span> Cómputo
        <span className="lg-dot" style={{background:'#F57324', marginLeft:14}}></span> Comunicación
        <span className="lg-dot" style={{background:'#E9DFC9', marginLeft:14}}></span> Idle
      </div>
      <div className="bar-chart">
        {data.map((d, i) => (
          <div key={i} className="bar-chart-row">
            <div className="bar-chart-label mono">{d.label}</div>
            <div className="bar-chart-track">
              <div className="bar compute" style={{width: (d.compute/max)*100 + '%'}}><span>{d.compute.toFixed(0)}%</span></div>
              <div className="bar comm" style={{width: (d.comm/max)*100 + '%'}}><span>{d.comm.toFixed(0)}%</span></div>
              <div className="bar idle" style={{width: (d.idle/max)*100 + '%'}}>{d.idle > 15 && <span>{d.idle.toFixed(0)}%</span>}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ResultsScreen });
