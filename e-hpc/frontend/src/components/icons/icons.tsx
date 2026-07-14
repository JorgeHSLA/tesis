// icons.tsx — los 29 iconos del handoff portados LITERALMENTE
// (handoff-design.md §9; paths idénticos a project/icons.jsx).
// Wrapper `Icon` con size=18 stroke=1.75. No se usa lucide-react:
// pixel-perfect manda (frontend-spec §5.5).
import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  size?: number
  /** stroke-width (número, como en el prototipo). */
  stroke?: number
}

export const Icon = ({ children, size = 18, stroke = 1.75, ...rest }: IconProps & { children?: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
)

export const IconHome = (p: IconProps) => <Icon {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></Icon>
export const IconCluster = (p: IconProps) => <Icon {...p}><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="12" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.5v4M12 11.5l-6.5 5.5M12 11.5l0 5.5M12 11.5l6.5 5.5"/></Icon>
export const IconPlay = (p: IconProps) => <Icon {...p}><path d="M6 4l14 8-14 8V4z"/></Icon>
export const IconResults = (p: IconProps) => <Icon {...p}><path d="M4 4h16v16H4z"/><path d="M8 14v4M12 10v8M16 6v12"/></Icon>
export const IconBook = (p: IconProps) => <Icon {...p}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5v-16z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></Icon>
export const IconTerminal = (p: IconProps) => <Icon {...p}><path d="M4 17l5-5-5-5"/><path d="M12 19h8"/><rect x="2" y="3" width="20" height="18" rx="2"/></Icon>
export const IconUpload = (p: IconProps) => <Icon {...p}><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></Icon>
export const IconFile = (p: IconProps) => <Icon {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/></Icon>
export const IconCpu = (p: IconProps) => <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></Icon>
export const IconMemory = (p: IconProps) => <Icon {...p}><rect x="3" y="8" width="18" height="10" rx="1.5"/><path d="M7 8V5M12 8V5M17 8V5M6 12v2M10 12v2M14 12v2M18 12v2"/></Icon>
export const IconNet = (p: IconProps) => <Icon {...p}><path d="M12 3a9 9 0 0 0 0 18M12 3a9 9 0 0 1 0 18M3 12h18"/></Icon>
export const IconPause = (p: IconProps) => <Icon {...p}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></Icon>
export const IconStop = (p: IconProps) => <Icon {...p}><rect x="5" y="5" width="14" height="14" rx="2"/></Icon>
export const IconCheck = (p: IconProps) => <Icon {...p}><path d="M4 12l5 5 11-11"/></Icon>
export const IconAlert = (p: IconProps) => <Icon {...p}><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.9L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></Icon>
export const IconSearch = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Icon>
export const IconUser = (p: IconProps) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>
export const IconArrowRight = (p: IconProps) => <Icon {...p}><path d="M5 12h14M13 5l7 7-7 7"/></Icon>
export const IconPlus = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>
export const IconDownload = (p: IconProps) => <Icon {...p}><path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></Icon>
export const IconClock = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>
export const IconSettings = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>
export const IconServer = (p: IconProps) => <Icon {...p}><rect x="3" y="3" width="18" height="8" rx="1.5"/><rect x="3" y="13" width="18" height="8" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></Icon>
export const IconZap = (p: IconProps) => <Icon {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></Icon>
export const IconCode = (p: IconProps) => <Icon {...p}><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></Icon>
export const IconChevronRight = (p: IconProps) => <Icon {...p}><path d="M9 6l6 6-6 6"/></Icon>
export const IconChevronLeft = (p: IconProps) => <Icon {...p}><path d="M15 6l-6 6 6 6"/></Icon>
export const IconHelp = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></Icon>
export const IconLayers = (p: IconProps) => <Icon {...p}><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/></Icon>
