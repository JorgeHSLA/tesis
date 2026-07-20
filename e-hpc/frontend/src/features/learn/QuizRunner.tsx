// QuizRunner — quiz MODELO SERVIDOR (frontend-spec §6.6, api-contract §5):
//  1. `Empezar quiz` → GET /lessons/{id}/quiz (preguntas SIN claves).
//  2. Responder TODAS las preguntas (radio a-d) habilita `Enviar respuestas`.
//  3. POST /lessons/{id}/quiz/attempts → la 201 trae score/passed y
//     `results[]` con correct_key + explanation: SOLO entonces se pinta el
//     feedback por pregunta y el resumen (aria-live).
//  4. progressStore.applyAttemptResult() actualiza la caché.
// No hay botón `Comprobar` por pregunta: la clave jamás viaja antes del
// intento (invariante del contrato).
import { useState } from 'react'
import { getQuiz, postQuizAttempt } from '../../api/content'
import type {
  LessonProgressDto,
  QuizAttemptResultDto,
  QuizDto,
  QuizOptionKey,
  QuizQuestionDto,
} from '../../api/types'
import { IconAlert, IconArrowRight, IconCheck, IconHelp } from '../../components/icons/icons'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { Skeleton } from '../../components/ui/Skeleton'
import { useProgressStore } from '../../stores/progressStore'

type Stage = 'teaser' | 'loading' | 'answering' | 'submitting' | 'result'

export interface QuizRunnerProps {
  lessonId: string
  questionCount: number
  progress: LessonProgressDto
}

interface QuestionProps {
  question: QuizQuestionDto
  selected: QuizOptionKey | undefined
  onSelect: (key: QuizOptionKey) => void
  result: QuizAttemptResultDto['results'][number] | undefined
  disabled: boolean
}

function Question({ question, selected, onSelect, result, disabled }: QuestionProps) {
  const stateCls = result ? (result.correct ? 'correct' : 'incorrect') : ''
  return (
    <fieldset className={`quiz-q ${stateCls}`} disabled={disabled}>
      <legend>
        {question.order}. {question.text}
      </legend>
      <div className="quiz-opts">
        {question.options.map((opt) => {
          const isSelected = selected === opt.key
          let optCls = ''
          if (result) {
            if (opt.key === result.correct_key) optCls = 'opt-correct'
            else if (isSelected && !result.correct) optCls = 'opt-incorrect'
          } else if (isSelected) {
            optCls = 'selected'
          }
          return (
            <label key={opt.key} className={`quiz-opt ${optCls}`}>
              <input
                type="radio"
                name={`quiz-${question.id}`}
                value={opt.key}
                checked={isSelected}
                onChange={() => onSelect(opt.key)}
              />
              <span className="quiz-opt-key">{opt.key})</span>
              <span>{opt.text}</span>
            </label>
          )
        })}
      </div>
      {result && (
        <div className="quiz-explanation">
          {result.correct ? <IconCheck size={14} /> : <IconAlert size={14} />}
          <span>
            {result.correct ? 'Correcto. ' : `Correcta: ${result.correct_key}) `}
            {result.explanation}
          </span>
        </div>
      )}
    </fieldset>
  )
}

export function QuizRunner({ lessonId, questionCount, progress }: QuizRunnerProps) {
  const applyAttemptResult = useProgressStore((s) => s.applyAttemptResult)
  const [stage, setStage] = useState<Stage>('teaser')
  const [quiz, setQuiz] = useState<QuizDto | null>(null)
  const [answers, setAnswers] = useState<Record<string, QuizOptionKey>>({})
  const [result, setResult] = useState<QuizAttemptResultDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setStage('loading')
    setError(null)
    setResult(null)
    setAnswers({})
    getQuiz(lessonId)
      .then((q) => {
        setQuiz({ ...q, questions: [...q.questions].sort((a, b) => a.order - b.order) })
        setStage('answering')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setStage('teaser')
      })
  }

  const submit = () => {
    if (!quiz) return
    setStage('submitting')
    setError(null)
    postQuizAttempt(lessonId, answers)
      .then((r) => {
        setResult(r)
        setStage('result')
        applyAttemptResult(r)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setStage('answering')
      })
  }

  if (stage === 'teaser') {
    return (
      <Card className="quiz-teaser" id="quiz">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="quiz-badge">
            <IconHelp size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Pon a prueba</div>
            <h3 className="display-md" style={{ margin: '2px 0 4px' }}>
              ¿Listo para el quiz?
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              {questionCount} preguntas — el servidor corrige y guarda tu mejor puntaje.
            </p>
            {progress.best_quiz_score != null && (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <span className="mono-small">
                  Mejor puntaje: {progress.best_quiz_score}/{progress.quiz_total}
                </span>
                {progress.completed && <Chip tone="green">Aprobado</Chip>}
              </div>
            )}
            {error !== null && (
              <p className="muted" role="alert" style={{ margin: '8px 0 0', color: 'var(--danger)' }}>
                No se pudo cargar el quiz: {error}
              </p>
            )}
          </div>
          <Button variant="primary" onClick={start}>
            Empezar quiz <IconArrowRight size={14} />
          </Button>
        </div>
      </Card>
    )
  }

  if (stage === 'loading' || quiz === null) {
    return (
      <Card className="quiz-teaser" id="quiz" aria-busy="true">
        <div className="col" style={{ gap: 10 }}>
          <Skeleton width={220} height={16} />
          <Skeleton height={90} radius="var(--r-md)" />
          <Skeleton height={90} radius="var(--r-md)" />
        </div>
      </Card>
    )
  }

  const answered = quiz.questions.filter((q) => answers[q.id] != null).length
  const allAnswered = answered === quiz.questions.length

  return (
    <Card id="quiz">
      <div className="card-pad quiz-runner">
        <div>
          <div className="eyebrow">Quiz de la lección</div>
          <h3 className="display-md" style={{ margin: '2px 0 0' }}>
            {quiz.question_count} preguntas
          </h3>
        </div>

        {quiz.questions.map((q) => (
          <Question
            key={q.id}
            question={q}
            selected={answers[q.id]}
            onSelect={(key) => setAnswers((prev) => ({ ...prev, [q.id]: key }))}
            result={result?.results.find((r) => r.question_id === q.id)}
            disabled={stage === 'submitting' || stage === 'result'}
          />
        ))}

        {/* Feedback del intento — aria-live para lectores de pantalla (§6.6) */}
        <div aria-live="polite">
          {stage === 'result' && result !== null && (
            <div className="quiz-summary">
              <span className="quiz-summary-score">
                {result.score}/{result.total}
              </span>
              {result.passed ? <Chip tone="green">Aprobado</Chip> : <Chip tone="red">No aprobado</Chip>}
              <span className="mono-small">
                umbral {Math.round(result.pass_threshold * 100)}% · corregido por el servidor
              </span>
              <Button variant="outline" size="sm" style={{ marginLeft: 'auto' }} onClick={start}>
                Reintentar quiz
              </Button>
            </div>
          )}
        </div>

        {stage !== 'result' && (
          <div className="quiz-footer">
            <span className="mono-small">
              respondidas {answered}/{quiz.questions.length}
            </span>
            {error !== null && (
              <span className="mono-small" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </span>
            )}
            <Button
              variant="primary"
              style={{ marginLeft: 'auto' }}
              disabled={!allAnswered || stage === 'submitting'}
              onClick={submit}
            >
              {stage === 'submitting' ? 'Enviando…' : 'Enviar respuestas'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
