import { useEffect, useRef, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { WireSpec } from '../shared/spec'
import { buildShapes } from './shapes'

const WS_URL = 'ws://127.0.0.1:8770'
const PREFIX = 'shape:wf-'

export default function App() {
  const [status, setStatus] = useState('连接中…')
  const [editor, setEditor] = useState<Editor | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editor) return
    let ws: WebSocket | null = null
    let closed = false
    // applySpec 期间产生的变更不回传，避免回环
    let suppressWriteback = false

    // 画布手工编辑 → 回传服务端 spec（仅位置/尺寸；单形状元素、卡片外框、屏幕框可映射）
    const collectWriteback = () => {
      const patches: Array<{ id: string; x: number; y: number; w?: number; h?: number }> = []
      for (const s of editor.getCurrentPageShapes()) {
        if (!s.id.startsWith(PREFIX)) continue
        const rest = s.id.slice(PREFIX.length)
        const geo = s.props as { w?: number; h?: number }
        if (s.type === 'frame') {
          patches.push({ id: rest, x: s.x, y: s.y, w: geo.w, h: geo.h })
        } else if (rest.endsWith('-box')) {
          patches.push({ id: rest.slice(0, -4), x: s.x, y: s.y, w: geo.w, h: geo.h })
        } else if (!rest.includes('-')) {
          patches.push({ id: rest, x: s.x, y: s.y, ...(geo.w !== undefined ? { w: geo.w, h: geo.h } : {}) })
        }
      }
      return patches
    }

    // 说明：store.listen 的回调依赖 history flush（rAF 驱动），普通 setInterval 在页面隐藏时
    // 被 Chrome 深度节流（最长每分钟 1 次）；因此轮询由 Web Worker 计时器驱动，后台同样有效。
    let lastSnapshot = ''
    const ticker = new Worker(
      URL.createObjectURL(
        new Blob(['setInterval(() => postMessage(0), 600)'], { type: 'text/javascript' }),
      ),
    )
    ticker.onmessage = () => {
      if (suppressWriteback || !ws || ws.readyState !== ws.OPEN) return
      const patches = collectWriteback()
      const snap = JSON.stringify(patches)
      if (snap !== lastSnapshot) {
        if (lastSnapshot !== '') ws.send(JSON.stringify({ type: 'writeback', patches }))
        lastSnapshot = snap
      }
    }

    const applySpec = (spec: WireSpec) => {
      suppressWriteback = true
      editor.run(() => {
        const old = editor.getCurrentPageShapes().filter((s) => s.id.startsWith(PREFIX))
        if (old.length) editor.deleteShapes(old.map((s) => s.id))
        const shapes = buildShapes(spec)
        if (shapes.length) {
          editor.createShapes(shapes)
          editor.zoomToFit()
        }
      })
      setTimeout(() => {
        suppressWriteback = false
      }, 800)
    }

    const handleExport = async (reqId: string, format: string) => {
      const reply = (r: { ok: boolean; svg?: string; dataUrl?: string; error?: string }) =>
        ws?.send(JSON.stringify({ type: 'export_result', reqId, ...r }))
      try {
        const shapes = editor.getCurrentPageShapes().filter((s) => s.id.startsWith(PREFIX))
        const anyEditor = editor as unknown as Record<string, (...a: unknown[]) => unknown>
        if (format === 'svg') {
          // 该版本 getSvgString 返回 { svg } 包装对象（实测），非纯字符串
          const r = (await anyEditor.getSvgString(shapes)) as unknown
          const svg = typeof r === 'string' ? r : String((r as { svg?: string })?.svg ?? '')
          if (!svg.startsWith('<')) {
            reply({ ok: false, error: 'getSvgString 未返回 SVG 文本' })
            return
          }
          reply({ ok: true, svg })
          return
        }
        let dataUrl: string | null = null
        if (typeof anyEditor.toImageDataUrl === 'function') {
          dataUrl = (await anyEditor.toImageDataUrl(shapes)) as string
        } else if (typeof anyEditor.toImage === 'function') {
          // 该版本 toImage 返回 { blob, width, height }（实测），需自行转 dataURL
          const img = (await anyEditor.toImage(shapes)) as { blob?: Blob } | null
          if (img?.blob) {
            dataUrl = await new Promise<string>((resolve, reject) => {
              const fr = new FileReader()
              fr.onload = () => resolve(String(fr.result))
              fr.onerror = () => reject(new Error('blob 读取失败'))
              fr.readAsDataURL(img.blob!)
            })
          }
        }
        if (dataUrl) reply({ ok: true, dataUrl })
        else reply({ ok: false, error: '当前 tldraw 版本不支持 toImageDataUrl/toImage' })
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }

    const connect = () => {
      ws = new WebSocket(WS_URL)
      ws.onopen = () => setStatus('已连接 MCP · ws://127.0.0.1:8770')
      ws.onerror = () => setStatus('未连接（先启动 pnpm dev:mcp）')
      ws.onclose = () => {
        if (closed) return
        setStatus('未连接（先启动 pnpm dev:mcp），3 秒后重试…')
        timer.current = setTimeout(connect, 3000)
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type: string; spec?: WireSpec; reqId?: string; format?: string }
          if (msg.type === 'spec' && msg.spec) applySpec(msg.spec)
          if (msg.type === 'export_request' && msg.reqId) void handleExport(msg.reqId, msg.format ?? 'svg')
        } catch {
          /* 忽略非 JSON 消息 */
        }
      }
    }
    connect()

    // e2e/调试钩子：允许脚本直接操作 editor（冒烟与写回验证用）
    ;(window as unknown as Record<string, unknown>).__wireEditor = editor

    return () => {
      closed = true
      ticker.terminate()
      if (timer.current) clearTimeout(timer.current)
      ws?.close()
    }
  }, [editor])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw persistenceKey="wireframes" onMount={(e) => setEditor(e)} />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: '#fff',
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: 12,
          fontFamily: 'sans-serif',
          boxShadow: '0 1px 4px rgba(0,0,0,.18)',
          pointerEvents: 'none',
        }}
      >
        tldraw 线稿画布 · MCP 桥：{status}
      </div>
    </div>
  )
}
