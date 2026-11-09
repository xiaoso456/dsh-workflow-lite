/**
 * dsh-workflow-lite — 两侧面板：步骤库开合、右侧面板看步骤库里的哪一项、窄视图抽屉互斥、浮层占掉的边距。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useSidePanels
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { LibraryFocus } from '../../../model/library.ts'
import { GAP, LIBRARY_W } from './geometry.ts'
import { writeLibraryPref } from './libraryPref.ts'

export interface SidePanelsInput {
  state: Workflow['state']
  narrow: boolean
  libraryPref: boolean
  setLibraryPref: React.Dispatch<React.SetStateAction<boolean>>
  setLibraryDrawer: React.Dispatch<React.SetStateAction<boolean>>
  libraryOpen: boolean
  inspectorW: number
}

export function useSidePanels({
  state,
  narrow,
  libraryPref,
  setLibraryPref,
  setLibraryDrawer,
  libraryOpen,
  inspectorW,
}: SidePanelsInput): {
  toggleLibrary(): void
  focus: LibraryFocus | null
  setFocus: React.Dispatch<React.SetStateAction<LibraryFocus | null>>
  insets: { left: number; right: number }
  insetsRef: React.MutableRefObject<{ left: number; right: number }>
} {
  const toggleLibrary = useCallback((): void => {
    if (narrow) {
      setLibraryDrawer((open) => !open)
      return
    }
    setLibraryPref(!libraryPref)
    writeLibraryPref(!libraryPref)
  }, [narrow, libraryPref])

  /** 右侧面板正在看步骤库里的哪一项；与画布上的选中互斥。 */
  const [focus, setFocus] = useState<LibraryFocus | null>(null)

  // 画布上选中了东西（点的，或刚加进来的步骤接管了选中）：右侧面板让给它。
  useEffect(() => {
    if (state.selection !== null) setFocus(null)
  }, [state.selection])

  // 窄视图：右侧（底部抽屉）要出来时把步骤库抽屉收回去，两块不叠在一起。
  useEffect(() => {
    if (narrow && (state.selection !== null || focus !== null)) setLibraryDrawer(false)
  }, [narrow, state.selection, focus])

  const hasInspector = (state.selection !== null || focus !== null) && !narrow
  const insets = {
    left: libraryOpen && !narrow ? LIBRARY_W + GAP : 0,
    right: hasInspector ? inspectorW + GAP : 0,
  }
  const insetsRef = useRef(insets)
  insetsRef.current = insets
  return { toggleLibrary, focus, setFocus, insets, insetsRef }
}
