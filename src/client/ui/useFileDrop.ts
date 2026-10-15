/**
 * dsh-workflow-lite — 把文件拖到带 `data-wl-file-drop` 的区域里：这块区域自己收，宿主不插手。
 *
 * 宿主在 `document` 上（冒泡阶段）听所有带文件的拖动：一进页面就盖上整页的「文件或图片拖动到此处即可添加」，
 * 放下去就当对话附件加进去，并且靠它自己的 dragenter / dragleave 计数收起那层。我们在区域里 `stopPropagation`
 * 的话，宿主收不到 drop、计数不归零，那层就一直盖着。
 *
 * 所以这里在 `document` 的**捕获阶段**先接住落在区域里的拖动事件（宿主在冒泡阶段，被我们截下后看不到），
 * 自己管高亮和放下；放下之后补发一个 `dragend`，让宿主把之前（从区域外进来时）攒的计数和遮罩清掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/useFileDrop
 */

import { useEffect, useRef, useState } from 'react'

const AREA = '[data-wl-file-drop]'

/** 拖动里带文件、并且落点在某个收文件的区域里；否则返回 null（不管）。 */
function fileTransferIn(event: globalThis.DragEvent): DataTransfer | null {
  const transfer = event.dataTransfer
  if (transfer === null || !transfer.types.includes('Files')) return null
  const target = event.target
  return target instanceof Element && target.closest(AREA) !== null ? transfer : null
}

/** 返回「有文件正拖在区域上」；放下时把第一个文件交给 `onFile`。 */
export function useFileDrop(onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(onFile)
  latest.current = onFile

  useEffect(() => {
    const onEnter = (event: globalThis.DragEvent): void => {
      if (fileTransferIn(event) === null) return
      event.stopPropagation()
      event.preventDefault()
      setDragging(true)
    }
    const onOver = (event: globalThis.DragEvent): void => {
      const transfer = fileTransferIn(event)
      if (transfer === null) return
      event.stopPropagation()
      event.preventDefault()
      transfer.dropEffect = 'copy'
    }
    const onLeave = (event: globalThis.DragEvent): void => {
      if (fileTransferIn(event) === null) return
      event.stopPropagation()
      // 在区域里的子元素之间挪也会冒 dragleave：只有真的挪出区域才算离开。
      const next = event.relatedTarget
      if (!(next instanceof Element && next.closest(AREA) !== null)) setDragging(false)
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const transfer = fileTransferIn(event)
      if (transfer === null) return
      event.stopPropagation()
      event.preventDefault()
      setDragging(false)
      const file = transfer.files[0]
      // 宿主的计数和遮罩靠 dragend 清（见文件头）。
      window.dispatchEvent(new Event('dragend'))
      if (file !== undefined) latest.current(file)
    }
    const stop = (): void => setDragging(false)
    document.addEventListener('dragenter', onEnter, true)
    document.addEventListener('dragover', onOver, true)
    document.addEventListener('dragleave', onLeave, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', stop)
    return () => {
      document.removeEventListener('dragenter', onEnter, true)
      document.removeEventListener('dragover', onOver, true)
      document.removeEventListener('dragleave', onLeave, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', stop)
    }
  }, [])

  return dragging
}
