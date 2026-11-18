import { useLayoutEffect, useRef } from 'react'
import type { InstanceSummary } from '../../../../shared/runState.ts'
import { RunKindMark, type RunTone, runIcon, runTone } from '../../chrome/KindMark.tsx'
import { MorphGlyph } from '../../motion/MorphGlyph.tsx'
import { RUN_GLYPH } from './runGlyphs.ts'
import css from './runHead.module.css'

export function RunDetailMark({ item }: { item: InstanceSummary }): React.JSX.Element {
  const tone = runTone(item)
  const id = item.id
  const before = useRef<{ id: string; tone: RunTone; completed: boolean } | null>(null)
  const previous = before.current
  const completed =
    tone === 'done' && previous?.id === id && (previous.tone === 'running' || previous.completed)
  useLayoutEffect(() => {
    before.current = { id, tone, completed }
  }, [id, tone, completed])

  return (
    <RunKindMark
      item={item}
      className={css.mark}
      glyph={
        <MorphGlyph
          icon={runIcon(item)}
          clipPath={RUN_GLYPH[tone]}
          motion={completed ? 'emphasized' : 'quick'}
          testId="wl-hub-run-status-glyph"
        />
      }
    />
  )
}
