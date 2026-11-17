// adminHelp — explicaciones del editor de lecciones, en un «?» que se abre cuando
// se necesita (antes eran frases fijas bajo cada campo que ocupaban sitio siempre).
import { HelpTip } from '../../../components/ui/HelpTip'

const Line = ({ children }: { children: React.ReactNode }) => <span className="help-line">{children}</span>

export const AdminHelp = {
  contenido: (
    <HelpTip topic="cómo escribir el contenido" title="Cómo escribir el contenido">
      <Line>
        <b>Títulos:</b> <code>#</code>, <code>##</code>, <code>###</code> o <code>####</code> al inicio de la línea (no hay
        nivel 5).
      </Line>
      <Line>
        <b>Estilo:</b> <code>**negrita**</code>, <code>*cursiva*</code> y <code>`código`</code>.
      </Line>
      <Line>
        <b>Listas:</b> <code>- viñeta</code> o <code>1. numerada</code>; para anidar, sangra con 2 espacios.
      </Line>
      <Line>
        <b>Código:</b> un bloque entre dos líneas de tres comillas invertidas.
      </Line>
      <Line>
        <b>Enlaces:</b> <code>[texto](https://…)</code>.
      </Line>
      <Line>
        <b>Tablas:</b> <code>| a | b |</code> y debajo <code>|---|---|</code>.
      </Line>
      <Line>
        <b>Imágenes:</b> botón «Insertar imagen», o arrastra / pega una sobre el texto. PNG, JPG, GIF o WebP de hasta 2 MB;
        se sube a la nube y queda escrita en su propia línea. Cambia la descripción entre corchetes por una frase que
        explique qué muestra.
      </Line>
      <Line>
        <b>No se puede:</b> HTML, líneas de más de 2000 caracteres ni imágenes de otros sitios.
      </Line>
      <Line>
        <b>Fuentes:</b> no van aquí; usa la sección «Fuentes de la lección».
      </Line>
    </HelpTip>
  ),
  fuentes: (
    <HelpTip topic="las fuentes de la lección" title="Fuentes de la lección">
      <Line>
        Son las referencias de donde sale la información (documentación oficial, artículos, libros). Prefiere fuentes
        oficiales y reconocidas.
      </Line>
      <Line>
        <b>Qué ve el estudiante:</b> etiquetas arriba de la lección; al pasar el cursor aparece la cita completa y el
        enlace para abrirla.
      </Line>
      <Line>
        <b>Título del enlace:</b> el texto de la etiqueta (obligatorio si hay enlace). <b>Enlace:</b> debe empezar por{' '}
        <code>https://</code>.
      </Line>
      <Line>
        <b>Autor o entidad</b> y <b>nota</b> son opcionales: completan la cita («OpenMP ARB … constructos task»).
      </Line>
      <Line>Una fuente sin enlace es solo una cita (por ejemplo, un libro). Se muestran en el orden de esta lista.</Line>
    </HelpTip>
  ),
} as const
