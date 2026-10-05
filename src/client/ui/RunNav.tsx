/**
 * dsh-workflow-lite — 实例顶栏最右（右栏开关右边）的「在看什么」：图标就是右栏里正在看的那个东西的图标（同色），
 * 概览是固定的概览图标；右栏收着时没有在看的东西，图标块不上色。点开按分类列出这次执行的节点
 * （概览 / 步骤 / 资源 / 输入），能搜，点一项就切过去（右栏收着就打开）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunNav
 */

import { useMemo, useState } from 'react'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { isInput, isResource, isStep } from '../../shared/model.ts'
import { resourceTitle } from '../../shared/resources.ts'
import type { RunState } from '../../shared/runState.ts'
import type { WorkflowDocument, WorkflowNode } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { findNode, type Selection } from '../model/editor.ts'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import { edgeHead, OverviewMark } from './NodeHeads.tsx'
import { cx, Popover } from './primitives.tsx'
import { ResourceIcon } from './Resources.tsx'
import { StatusChip } from './RunNodeState.tsx'
import run from './run.module.css'
import { lookOf, StepMark } from './StepMark.tsx'
import top from './topbar.module.css'
import ui from './ui.module.css'

function nodeIcon(node: WorkflowNode, size: number): React.JSX.Element {
  if (isResource(node)) return <ResourceIcon resource={node} size={size - 1} />
  if (isInput(node)) {
    return (
      <span className={hand.askIcon}>
        <Icon name="ask" size={size - 1} />
      </span>
    )
  }
  return <StepMark look={lookOf(node.id, node.data)} size={size} />
}

function nodeName(t: T, node: WorkflowNode): string {
  if (isResource(node)) return resourceTitle(node)
  if (isInput(node)) {
    const question = node.data.question.trim()
    return question === '' ? t('input.questionEmpty') : question
  }
  return node.data.label === undefined || node.data.label.trim() === '' ? node.id : node.data.label
}

export function RunNav(props: {
  t: T
  doc: WorkflowDocument
  analysis: GraphAnalysis
  state: RunState | null
  selection: Selection
  /** 右栏收着：没有在看的东西，图标块不上色（不像是开着的）。 */
  idle: boolean
  onPick(selection: Selection): void
}): React.JSX.Element {
  const { t, doc, selection } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  let mark: React.ReactNode = <OverviewMark />
  let what = t('run.overview')
  if (selection?.kind === 'node') {
    const node = findNode(doc, selection.id)
    if (node !== undefined) {
      mark = nodeIcon(node, 14)
      what = nodeName(t, node)
    }
  } else if (selection?.kind === 'edge') {
    const edge = doc.edges.find((candidate) => candidate.id === selection.id)
    if (edge !== undefined) {
      const head = edgeHead(doc, props.analysis, edge)
      mark = (
        <span className={ins.edgeIcon}>
          <Icon name={head.icon} size={14} />
        </span>
      )
      what = t(head.title)
    }
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const hit = (node: WorkflowNode): boolean =>
      needle === '' ||
      node.id.toLowerCase().includes(needle) ||
      nodeName(t, node).toLowerCase().includes(needle)
    return [
      { key: 'step', title: t('run.navSteps'), nodes: doc.nodes.filter(isStep).filter(hit) },
      {
        key: 'resource',
        title: t('run.navResources'),
        nodes: doc.nodes.filter(isResource).filter(hit),
      },
      { key: 'input', title: t('run.navInputs'), nodes: doc.nodes.filter(isInput).filter(hit) },
    ].filter((group) => group.nodes.length > 0)
  }, [doc.nodes, query, t])
  const showOverview =
    query.trim() === '' || t('run.overview').toLowerCase().includes(query.trim().toLowerCase())

  const pick = (next: Selection): void => {
    setOpen(false)
    setQuery('')
    props.onPick(next)
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t('run.navTitle')}
      align="end"
      className={cx(top.menu, run.navMenu)}
      trigger={
        <button
          type="button"
          className={run.nav}
          data-tip={t('run.navTip')}
          aria-label={`${t('run.navTip')}：${what}`}
          aria-expanded={open}
          data-testid="wl-run-nav"
          data-idle={props.idle}
          onClick={() => setOpen(!open)}
        >
          {mark}
          <Icon name="chevronDown" size={12} />
        </button>
      }
    >
      <div className={top.search}>
        <Icon name="search" size={14} />
        <input
          className={top.searchInput}
          value={query}
          placeholder={t('run.navSearch')}
          aria-label={t('run.navSearch')}
          data-testid="wl-run-nav-search"
          // biome-ignore lint/a11y/noAutofocus: 打开就是为了找一个
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            const first = groups[0]?.nodes[0]
            if (first !== undefined) pick({ kind: 'node', id: first.id })
            else if (showOverview) pick(null)
          }}
        />
      </div>
      <div className={run.navList} role="listbox" aria-label={t('run.navTitle')}>
        {showOverview && (
          <button
            type="button"
            role="option"
            aria-selected={selection === null}
            className={ui.menuItem}
            data-active={selection === null}
            data-testid="wl-run-nav-item"
            data-id=""
            onClick={() => pick(null)}
          >
            <OverviewMark />
            <span className={ui.menuLabel}>{t('run.overview')}</span>
          </button>
        )}
        {groups.map((group) => (
          <div key={group.key} className={run.navGroup}>
            <p className={ui.menuTitle}>
              {group.title}
              <span className={run.navCount}>{group.nodes.length}</span>
            </p>
            {group.nodes.map((node) => {
              const active = selection?.kind === 'node' && selection.id === node.id
              const name = nodeName(t, node)
              return (
                <button
                  key={node.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={ui.menuItem}
                  data-active={active}
                  data-testid="wl-run-nav-item"
                  data-id={node.id}
                  data-tip={name === node.id ? node.id : `${name}\n${node.id}`}
                  onClick={() => pick({ kind: 'node', id: node.id })}
                >
                  {nodeIcon(node, 14)}
                  <span className={ui.menuLabel}>{name}</span>
                  {isStep(node) && (
                    <StatusChip t={t} status={props.state?.nodes[node.id]?.status} />
                  )}
                </button>
              )
            })}
          </div>
        ))}
        {groups.length === 0 && !showOverview && (
          <p className={top.emptyLine}>{t('run.navNone')}</p>
        )}
      </div>
    </Popover>
  )
}
