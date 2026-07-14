// App shell: sidebar + topbar + router

const NAV_ITEMS = [
  { id: 'home',      label: 'Inicio',     icon: IconHome,    section: 'general' },
  { id: 'simulator', label: 'Simulador',  icon: IconCluster, section: 'simulador' },
  { id: 'results',   label: 'Resultados', icon: IconResults, section: 'simulador' },
  { id: 'catalog',   label: 'Aprender (ZINE)', icon: IconBook, section: 'aprendizaje' },
];

const SECTION_LABELS = {
  general: 'General',
  simulador: 'Simulador',
  aprendizaje: 'Aprendizaje',
};

function Sidebar({ current, onNav }) {
  const sections = ['general', 'simulador', 'aprendizaje'];
  const [expanded, setExpanded] = React.useState(() => {
    const saved = localStorage.getItem('ehpc-sidebar-expanded');
    return saved === null ? false : saved === 'true';
  });
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('ehpc-sidebar-expanded', String(next));
  };

  return (
    <aside className={'sidebar ' + (expanded ? 'expanded' : 'collapsed')}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">E</div>
        <div className="sidebar-brand-textwrap">
          <div className="sidebar-brand-text">E-HPC</div>
          <div className="sidebar-brand-sub">v0.4 · local</div>
        </div>
      </div>

      <button className="sidebar-toggle" onClick={toggle}
              title={expanded ? 'Colapsar menú' : 'Expandir menú'}>
        {expanded ? <IconChevronLeft size={14}/> : <IconChevronRight size={14}/>}
        <span className="nav-label">Colapsar</span>
      </button>

      <div className="sidebar-nav">
        {sections.map(sec => (
          <React.Fragment key={sec}>
            <div className="nav-section-label">{SECTION_LABELS[sec]}</div>
            {NAV_ITEMS.filter(i => i.section === sec).map(item => {
              const Ico = item.icon;
              const active = current === item.id;
              return (
                <button key={item.id}
                        className={'nav-item ' + (active ? 'active' : '')}
                        data-tip={item.label}
                        onClick={() => onNav(item.id)}>
                  <span className="nav-icon"><Ico size={17}/></span>
                  <span className="nav-label">{item.label}</span>
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="status-dot"></span>
        <div className="sidebar-footer-text">
          <div style={{color:'var(--text)', fontWeight:500}}>Docker runtime</div>
          <div>3 contenedores activos</div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ title, crumbs = [], actions }) {
  return (
    <div className="topbar">
      <div className="topbar-crumb">
        {crumbs.map((c, i) => (
          <span key={i}>{c}{i < crumbs.length - 1 && ' / '}</span>
        ))}
      </div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-spacer"></div>
      {actions}
    </div>
  );
}

Object.assign(window, { NAV_ITEMS, Sidebar, TopBar });
