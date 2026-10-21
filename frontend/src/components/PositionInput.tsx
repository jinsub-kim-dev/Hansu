import { useState } from 'react'
import { useI18n } from '../i18n'
import { parsePositionInput, type Line } from '../lib/line'

interface Props {
  onLoad: (line: Line) => void
}

export function PositionInput({ onLoad }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load() {
    try {
      onLoad(parsePositionInput(text))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="panel sec-amber">
      <h2>{t('position.title')}</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={t('position.placeholder')}
        spellCheck={false}
      />
      <div className="row">
        <button onClick={load}>{t('position.load')}</button>
        <button
          className="secondary"
          onClick={() => {
            setText('')
            setError(null)
            onLoad(parsePositionInput(''))
          }}
        >
          {t('position.reset')}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
