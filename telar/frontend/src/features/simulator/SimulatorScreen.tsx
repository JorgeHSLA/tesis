// SimulatorScreen — ruta /simulador (idle) y /simulador/:jobId (live).
// Una pantalla, dos cuerpos (frontend-spec §6.2-§6.3). Los estilos de ambas
// variantes viven en styles/screens/simulator.css (este chunk los carga).
import { useParams } from 'react-router-dom'
import '../../styles/screens/simulator.css'
import { SimulatorIdle } from './SimulatorIdle'
import { SimulatorLive } from './SimulatorLive'

export default function SimulatorScreen() {
  const { jobId } = useParams<{ jobId: string }>()
  if (jobId != null && jobId !== '') return <SimulatorLive jobId={jobId} />
  return <SimulatorIdle />
}
