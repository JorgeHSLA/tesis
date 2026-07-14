// App root — router + state

const { useState, useEffect } = React;

const VARIANTS = [
  { id: 'v1', label: 'v1 · cálido' },
  { id: 'v2', label: 'v2 · local app' },
];

function App() {
  const [variant, setVariant] = useState(() => localStorage.getItem('ehpc-variant') || 'v1');
  const [screen, setScreen] = useState('home');
  const [simStatus, setSimStatus] = useState('idle'); // 'idle' | 'running' | 'finished'
  const [mode, setMode] = useState('sim');

  useEffect(() => {
    localStorage.setItem('ehpc-variant', variant);
    document.documentElement.dataset.variant = variant;
  }, [variant]);

  useEffect(() => {
    if (screen === 'learn' || screen === 'catalog') setMode('learn');
    else if (['simulator','results'].includes(screen)) setMode('sim');
  }, [screen]);

  const [config, setConfig] = useState({
    workers: 4,
    workerPct: 18,
    headPct: 15,
    framework: 'Slurm (sbatch)',
    codeFile: 'heat-diffusion-2d.py',
    code: null,
  });

  const [activeLesson, setActiveLesson] = useState('mpi-comm');
  const openLesson = (id) => { setActiveLesson(id); nav('learn'); };

  const nav = (id) => {
    setScreen(id);
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const screens = {
    home:      <HomeScreen onNav={nav}/>,
    simulator: <SimulatorScreen config={config} setConfig={setConfig}
                                 status={simStatus} setStatus={setSimStatus}
                                 onViewResults={() => { setSimStatus('finished'); nav('results'); }}/>,
    results:   <ResultsScreen config={config} onNav={nav}/>,
    catalog:   <CatalogScreen onOpenLesson={openLesson}/>,
    learn:     <LearnScreen lessonId={activeLesson} onBackToCatalog={() => nav('catalog')}/>,
  };

  const titles = {
    home:      { title: 'Inicio', crumbs: ['E-HPC'] },
    simulator: {
      title: simStatus === 'idle' ? 'Simulador · Configurar' : 'Simulador · En vivo',
      crumbs: ['Simulador', simStatus === 'idle' ? 'Configurar' : 'En vivo'],
    },
    results:   { title: 'Resultados', crumbs: ['Simulador', 'Resultados'] },
    catalog:   { title: 'Aprendizaje · Catálogo', crumbs: ['Aprendizaje', 'Catálogo'] },
    learn:     { title: 'ZINE · Aprender', crumbs: ['Aprendizaje', 'Módulo', 'Lección'] },
  };

  const topActions = (
    <div className="row" style={{gap:6}}>
      <button className="btn btn-ghost btn-sm"><IconSearch size={14}/> Buscar</button>
      <button className="btn btn-ghost btn-sm"><IconHelp size={14}/></button>
      <div style={{width:1, height:22, background:'var(--border)', margin:'0 4px'}}></div>
      <div className="row" style={{gap:8, padding:'0 8px'}}>
        <div style={{width:28, height:28, borderRadius:'50%', background:'var(--orange-200)', color:'var(--orange-700)', display:'grid', placeItems:'center', fontSize:12, fontWeight:600}}>MV</div>
        <span style={{fontSize:13}}>estudiante</span>
      </div>
    </div>
  );

  const variantSwitcher = (
    <div className="variant-switch">
      {VARIANTS.map(v => (
        <button key={v.id}
                className={'vs-btn ' + (variant === v.id ? 'active' : '')}
                onClick={() => setVariant(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={'app ' + variant}>
      <Sidebar current={screen} onNav={nav}/>
      <div className="main">
        <TopBar title={titles[screen].title} crumbs={titles[screen].crumbs}
                actions={<>{variantSwitcher}{topActions}</>}/>
        {screens[screen]}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
