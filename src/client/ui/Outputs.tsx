/**
 * dsh-workflow-lite — 产出文件：面板里的清单，与编辑 / 查看单个文件的模态框。
 *
 * 清单只负责"一眼看全"：每个文件一行，路径 + 生成规则的头两行。要改哪一个就点它，
 * 在模态框里有完整的空间写路径和规则——面板那一条窄栏里塞两个输入框加一个大文本框，
 * 多来几个文件就挤成一团。模态框里的改动"完成"时才一次交出去（一次改动 = 一条撤销步），
 * 交出去的永远是合法的值。
 *
 * 画布卡片上的产出浮窗、步骤面板、「我的步骤」编辑器、内置步骤的只读详情，都走这里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Outputs
 */

import { useEffect, useRef, useState } from 'react'
import { MAX_TEXT_CODEPOINTS } from '../../shared/limits.ts'
import { canonicalOutput, outputSpecs } from '../../shared/model.ts'
import { checkOutput, checkText, codepointLength } from '../../shared/naming.ts'
import type { NodeData, OutputSpec } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import css from './inspector.module.css'
import overlay from './overlay.module.css'
import { cx, Modal, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

type OutputMode = 'unset' | 'file' | 'none'

function outputMode(output: NodeData['output']): OutputMode {
  if (output === undefined) return 'unset'
  return output === false ? 'none' : 'file'
}

/** 要从外面（画布卡片的浮窗）打开哪一项：`seq` 每次请求都变，同一项点两次也能再开。 */
export interface OutputRequest {
  index: number | 'new'
  seq: number
}

// ─────────────────────────────────────────────────────────────
// 可编辑的清单
// ─────────────────────────────────────────────────────────────

/**
 * 产出：不声明 / 写入文件 / 不产出；「写入文件」下面是文件清单。
 * 步骤面板与「我的步骤」编辑器共用它。
 */
export function OutputField(props: {
  t: T
  value: NodeData['output']
  /** 切到「写入文件」或新加一项时预填的文件名。 */
  suggest: string
  /** 这些产出属于谁（模态框的副标题）。 */
  owner: string
  onChange(value: NodeData['output']): void
  request?: OutputRequest | null
  onRequestDone?: () => void
}): React.JSX.Element {
  const { t, value } = props
  const mode = outputMode(value)
  const specs = outputSpecs(value)
  /** 正在模态框里改哪一项。 */
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  /** 切去「不声明」再切回来，清单还在。 */
  const remembered = useRef<OutputSpec[]>(specs)
  if (specs.length > 0) remembered.current = specs

  const request = props.request ?? null
  useEffect(() => {
    if (request === null) return
    setEditing(
      request.index === 'new' || request.index < outputSpecs(value).length ? request.index : null,
    )
    props.onRequestDone?.()
  }, [request?.seq])

  const choose = (next: OutputMode): void => {
    if (next === mode) return
    if (next === 'unset') props.onChange(undefined)
    if (next === 'none') props.onChange(false)
    if (next === 'file') {
      // 给一个现成的文件名，省得人面对一个空清单。
      props.onChange(
        canonicalOutput(
          remembered.current.length > 0 ? remembered.current : [{ path: props.suggest }],
        ),
      )
    }
  }

  const replace = (next: OutputSpec[]): void => {
    props.onChange(next.length === 0 ? undefined : canonicalOutput(next))
  }

  return (
    <section className={css.field}>
      <div className={css.label}>
        <span>{t('ins.output')}</span>
        {specs.length > 1 && (
          <span className={css.count}>
            {specs.length} {t('out.files')}
          </span>
        )}
      </div>
      <Segmented<OutputMode>
        label={t('ins.output')}
        value={mode}
        onChange={choose}
        options={[
          { value: 'unset', label: t('ins.output.unset') },
          { value: 'file', label: t('ins.output.file') },
          { value: 'none', label: t('ins.output.none') },
        ]}
      />
      {mode === 'file' && (
        <div className={css.outList} data-testid="wl-outputs">
          {specs.map((spec, index) => (
            <div key={spec.path} className={cx(css.outItem, ui.rise)}>
              <OutputRow t={t} spec={spec} editable onOpen={() => setEditing(index)} />
              {specs.length > 1 && (
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon, ui.small, ui.danger, css.outRemove)}
                  aria-label={t('out.remove')}
                  data-testid="wl-output-remove"
                  onClick={() => replace(specs.filter((_, at) => at !== index))}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={css.outAdd}
            data-testid="wl-output-add"
            onClick={() => setEditing('new')}
          >
            <Icon name="plus" size={13} />
            {t('ins.output.add')}
          </button>
        </div>
      )}
      {mode === 'none' && <p className={css.help}>{t('out.noneHint')}</p>}
      {mode === 'unset' && <p className={css.help}>{t('out.unsetHint')}</p>}

      {editing !== null && (
        <OutputEditor
          t={t}
          owner={props.owner}
          initial={editing === 'new' ? null : (specs[editing] ?? null)}
          suggest={freePath(props.suggest, specs)}
          taken={specs.filter((_, at) => at !== editing).map((spec) => spec.path)}
          canRemove={editing !== 'new' && specs.length > 1}
          onSave={(spec) => {
            setEditing(null)
            if (editing === 'new') replace([...specs, spec])
            else replace(specs.map((old, at) => (at === editing ? spec : old)))
          }}
          onRemove={() => {
            setEditing(null)
            replace(specs.filter((_, at) => at !== editing))
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

/** 新加一项时的建议名：`x.md` 被占了就 `x-2.md`、`x-3.md`… */
function freePath(suggest: string, specs: readonly OutputSpec[]): string {
  const taken = new Set(specs.map((spec) => spec.path))
  if (!taken.has(suggest)) return suggest
  const dot = suggest.lastIndexOf('.')
  const stem = dot > 0 ? suggest.slice(0, dot) : suggest
  const ext = dot > 0 ? suggest.slice(dot) : ''
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/** 清单里的一行：文件路径 + 生成规则的头两行。整行就是"打开它"的按钮。 */
function OutputRow(props: {
  t: T
  spec: OutputSpec
  editable: boolean
  onOpen(): void
}): React.JSX.Element {
  const { t, spec } = props
  const rule = spec.rule?.trim() ?? ''
  return (
    <button
      type="button"
      className={css.outMain}
      data-testid="wl-output-item"
      data-editable={props.editable}
      onClick={props.onOpen}
    >
      <span className={css.outIcon}>
        <Icon name="file" size={14} />
      </span>
      <span className={css.outPath}>{spec.path}</span>
      <span className={cx(css.outRule, rule === '' && css.outRuleEmpty)}>
        {rule !== '' ? rule : props.editable ? t('out.addRuleCta') : t('out.noRule')}
      </span>
      <span className={css.outGo} aria-hidden="true">
        <Icon name={props.editable ? 'pencil' : 'arrowRight'} size={13} />
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// 只读的清单（内置步骤）
// ─────────────────────────────────────────────────────────────

/** 只读地列出产出：点一个文件，在模态框里看它的完整生成规则。 */
export function OutputList(props: {
  t: T
  output: NodeData['output']
  owner: string
}): React.JSX.Element {
  const { t, output } = props
  const specs = outputSpecs(output)
  const [viewing, setViewing] = useState<OutputSpec | null>(null)
  if (specs.length === 0) {
    return (
      <span className={css.readonlyChip}>
        <Icon name="file" size={13} />
        {output === false ? t('step.noFile') : t('step.noOutput')}
      </span>
    )
  }
  return (
    <div className={css.outList} data-testid="wl-outputs">
      {specs.map((spec) => (
        <OutputRow
          key={spec.path}
          t={t}
          spec={spec}
          editable={false}
          onOpen={() => setViewing(spec)}
        />
      ))}
      {viewing !== null && (
        <OutputViewer t={t} owner={props.owner} spec={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 模态框
// ─────────────────────────────────────────────────────────────

function SheetHead(props: {
  t: T
  icon: 'file' | 'plus'
  title: string
  owner: string
  onClose(): void
}): React.JSX.Element {
  return (
    <header className={overlay.sheetHead}>
      <span className={overlay.sheetIcon}>
        <Icon name={props.icon} size={16} />
      </span>
      <div className={overlay.sheetTitles}>
        <p className={overlay.sheetTitle}>{props.title}</p>
        {props.owner !== '' && <p className={overlay.sheetSub}>{props.owner}</p>}
      </div>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        aria-label={props.t('common.close')}
        onClick={props.onClose}
      >
        <Icon name="x" size={15} />
      </button>
    </header>
  )
}

/** 编辑（或新加）一个产出文件：路径 + 生成规则。 */
function OutputEditor(props: {
  t: T
  owner: string
  /** `null` = 新加一项。 */
  initial: OutputSpec | null
  suggest: string
  /** 同一步骤里其它文件的路径（查重名用）。 */
  taken: readonly string[]
  canRemove: boolean
  onSave(spec: OutputSpec): void
  onRemove(): void
  onClose(): void
}): React.JSX.Element {
  const { t, initial } = props
  const [path, setPath] = useState(initial?.path ?? props.suggest)
  const [rule, setRule] = useState(initial?.rule ?? '')
  const pathRef = useRef<HTMLInputElement>(null)
  const ruleRef = useRef<HTMLTextAreaElement>(null)

  // 新加的：选中文件名（不含扩展名），直接打字就是改名。已有的：多半是来补规则的，光标进规则框。
  useEffect(() => {
    if (initial === null) {
      const input = pathRef.current
      if (input === null) return
      input.focus()
      const dot = input.value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
      return
    }
    const area = ruleRef.current
    if (area === null) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [])

  const trimmed = path.trim()
  const pathError =
    trimmed === ''
      ? t('ins.output.empty')
      : checkOutput(trimmed) !== null
        ? t('ins.outputInvalid')
        : props.taken.includes(trimmed)
          ? t('ins.output.duplicate')
          : null
  const ruleError = checkText(rule, t('ins.output.rule'))?.message ?? null
  const valid = pathError === null && ruleError === null
  const dirty = trimmed !== (initial?.path ?? props.suggest) || rule !== (initial?.rule ?? '')

  const submit = (): void => {
    if (!valid) return
    props.onSave(rule.trim() === '' ? { path: trimmed } : { path: trimmed, rule: rule.trim() })
  }

  return (
    <Modal
      label={initial === null ? t('out.newTitle') : t('out.editTitle')}
      testId="wl-output-dialog"
      // 有没写完的改动时，点遮罩不关——一不小心点歪就丢掉一段规则太亏了。Esc 和「取消」照常。
      onDismiss={() => {
        if (!dirty) props.onClose()
      }}
    >
      <form
        className={overlay.sheetForm}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // 「取消」的快捷键：有改动也照样关（模态框那层的 Esc 在有改动时不关，这里先接住）。
            event.stopPropagation()
            props.onClose()
            return
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      >
        <SheetHead
          t={t}
          icon={initial === null ? 'plus' : 'file'}
          title={initial === null ? t('out.newTitle') : t('out.editTitle')}
          owner={props.owner}
          onClose={props.onClose}
        />
        <div className={overlay.sheetBody}>
          <section className={css.field}>
            <label className={css.label} htmlFor="wl-output-path">
              <span>{t('out.path')}</span>
            </label>
            <input
              id="wl-output-path"
              ref={pathRef}
              className={cx(ui.input, ui.mono)}
              value={path}
              placeholder={t('ins.outputPlaceholder')}
              aria-invalid={pathError !== null}
              data-testid="wl-output-path"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setPath(event.currentTarget.value)}
            />
            {pathError !== null && path !== '' ? (
              <p className={css.error}>{pathError}</p>
            ) : (
              <p className={css.help}>{t('out.pathHint')}</p>
            )}
          </section>
          <section className={css.field}>
            <label className={css.label} htmlFor="wl-output-rule">
              <span>
                {t('ins.output.rule')}
                <span className={css.optional}>{t('out.optional')}</span>
              </span>
              <span className={css.count}>
                {codepointLength(rule)} / {MAX_TEXT_CODEPOINTS}
              </span>
            </label>
            <textarea
              id="wl-output-rule"
              ref={ruleRef}
              className={cx(ui.textarea, css.ruleArea)}
              value={rule}
              placeholder={t('ins.output.rulePlaceholder')}
              aria-invalid={ruleError !== null}
              data-testid="wl-output-rule"
              onChange={(event) => setRule(event.currentTarget.value)}
            />
            {ruleError !== null ? (
              <p className={css.error}>{ruleError}</p>
            ) : (
              <p className={css.help}>{t('out.ruleHint')}</p>
            )}
          </section>
        </div>
        <footer className={overlay.sheetFoot}>
          {props.canRemove && (
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.danger)}
              data-testid="wl-output-dialog-remove"
              onClick={props.onRemove}
            >
              <Icon name="trash" size={14} />
              {t('out.remove')}
            </button>
          )}
          <span className={ui.grow} />
          <span className={overlay.sheetKeys}>{t('out.submitKeys')}</span>
          <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={cx(ui.btn, ui.small, ui.primary)}
            disabled={!valid}
            data-testid="wl-output-done"
          >
            <Icon name="check" size={14} />
            {t('out.done')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** 只读地看一个产出文件（内置步骤）。 */
function OutputViewer(props: {
  t: T
  owner: string
  spec: OutputSpec
  onClose(): void
}): React.JSX.Element {
  const { t, spec } = props
  const rule = spec.rule?.trim() ?? ''
  return (
    <Modal label={t('out.viewTitle')} testId="wl-output-dialog" onDismiss={props.onClose}>
      <SheetHead
        t={t}
        icon="file"
        title={t('out.viewTitle')}
        owner={props.owner}
        onClose={props.onClose}
      />
      <div className={overlay.sheetBody}>
        <section className={css.field}>
          <div className={css.label}>
            <span>{t('out.path')}</span>
          </div>
          <span className={css.readonlyChip}>
            <Icon name="file" size={13} />
            {spec.path}
          </span>
        </section>
        <section className={css.field}>
          <div className={css.label}>
            <span>{t('ins.output.rule')}</span>
          </div>
          {rule === '' ? (
            <p className={css.help}>{t('out.noRule')}</p>
          ) : (
            <div className={cx(css.readonly, css.readonlyShort)} data-testid="wl-output-rule-view">
              {rule}
            </div>
          )}
          <p className={css.help}>{t('out.ruleHint')}</p>
        </section>
      </div>
      <footer className={overlay.sheetFoot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-testid="wl-output-done"
          onClick={props.onClose}
        >
          {t('common.close')}
        </button>
      </footer>
    </Modal>
  )
}
