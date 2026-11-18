import { Icon, type IconName } from '../kit/Icon.tsx'
import css from './morphGlyph.module.css'

export function MorphGlyph(props: {
  icon: IconName
  clipPath: string
  motion?: 'quick' | 'emphasized'
  testId?: string
}): React.JSX.Element {
  return (
    <span className={css.glyph} aria-hidden="true" data-motion={props.motion}>
      <Icon name={props.icon} size={18} />
      <span className={css.shape} style={{ clipPath: props.clipPath }} data-testid={props.testId} />
    </span>
  )
}
