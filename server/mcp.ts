/**
 * tldraw 线稿 MCP server（stdio）。
 * 职责：持有 WireSpec（唯一事实源）→ 广播给本地画布 → 持久化 / 无头导出 SVG。
 * 注意：stdout 是 MCP 通道，日志一律走 stderr。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { WebSocketServer, type WebSocket } from 'ws'
import fs from 'node:fs'
import path from 'node:path'
import { emptySpec, isWireSpec, type WireItem, type WireSpec } from '../shared/spec'
import { renderSpecSvg } from '../shared/svg'

const WS_PORT = 8770

const itemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'screen', 'statusbar', 'navbar', 'tabbar', 'button', 'chip', 'input',
    'card', 'list_item', 'section', 'text', 'divider', 'image', 'map',
  ]),
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
  label: z.string().optional(),
  secondary: z.string().optional(),
  meta: z.string().optional(),
  screen: z.string().optional(),
})

let spec: WireSpec = emptySpec()
const clients = new Set<WebSocket>()
const pendingExports = new Map<string, { resolve: (r: ExportResult) => void; timer: ReturnType<typeof setTimeout> }>()

interface ExportResult {
  ok: boolean
  svg?: string
  dataUrl?: string
  error?: string
}

interface WritebackPatch {
  id: string
  x?: number
  y?: number
  w?: number
  h?: number
}

// 画布桥端口被占用（例如另一个会话的 server 已持有）时降级为纯 stdio，不让整个 MCP 崩掉
const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' })
wss.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log(`画布桥端口 ${WS_PORT} 已被占用，本实例仅提供 stdio 工具（无画布实时同步/原生导出）`)
  } else {
    log(`画布桥错误：${err.message}`)
  }
})
wss.on('connection', (ws) => {
  clients.add(ws)
  log(`画布已连接（当前 ${clients.size} 个）`)
  ws.send(JSON.stringify({ type: 'spec', spec }))
  ws.on('message', (raw) => {
    let msg: { type?: string; reqId?: string; patches?: WritebackPatch[]; ok?: boolean; svg?: string; dataUrl?: string; error?: string }
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.type === 'writeback' && Array.isArray(msg.patches)) {
      let n = 0
      for (const p of msg.patches) {
        const item = spec.items.find((i) => i.id === p.id)
        if (!item) continue
        if (typeof p.x === 'number') item.x = p.x
        if (typeof p.y === 'number') item.y = p.y
        const sized = item.kind === 'screen' || item.kind === 'card' || item.kind === 'button' || item.kind === 'chip' || item.kind === 'input' || item.kind === 'divider' || item.kind === 'image' || item.kind === 'map'
        if (sized) {
          if (typeof p.w === 'number') item.w = p.w
          if (typeof p.h === 'number') item.h = p.h
        }
        n++
      }
      if (n) log(`画布编辑回传：更新 ${n} 个元素（不广播，避免回环）`)
    }
    if (msg.type === 'export_result' && msg.reqId) {
      const pending = pendingExports.get(msg.reqId)
      if (pending) {
        clearTimeout(pending.timer)
        pendingExports.delete(msg.reqId)
        pending.resolve({ ok: !!msg.ok, svg: msg.svg, dataUrl: msg.dataUrl, error: msg.error })
      }
    }
  })
  ws.on('close', () => {
    clients.delete(ws)
    log(`画布断开（剩余 ${clients.size} 个）`)
  })
})

function log(msg: string) {
  console.error(`[wire-mcp] ${msg}`)
}

function broadcast() {
  const msg = JSON.stringify({ type: 'spec', spec })
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(msg)
}

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

function upsertItems(items: WireItem[]): { added: number; replaced: number } {
  let added = 0
  let replaced = 0
  for (const it of items) {
    const idx = spec.items.findIndex((x) => x.id === it.id)
    if (idx >= 0) {
      spec.items[idx] = it
      replaced++
    } else {
      spec.items.push(it)
      added++
    }
  }
  broadcast()
  return { added, replaced }
}

const server = new McpServer(
  { name: 'tldraw-wire-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.tool(
  'wf_draw',
  '在本地 tldraw 画布上绘制线稿元素（屏幕框/导航栏/按钮/输入框/卡片/列表项/分区标题/占位图等）。items 内每个元素带稳定 id，重复 id 为替换。画布没开也能画，内容存在服务端 spec 里。',
  { items: z.array(itemSchema).min(1).max(300) },
  async ({ items }) => {
    const { added, replaced } = upsertItems(items)
    return {
      content: [{
        type: 'text',
        text: `已绘制：新增 ${added}、替换 ${replaced}；当前共 ${spec.items.length} 个元素、${spec.conns.length} 条连线。画布${clients.size ? '在线，已实时更新' : '未连接（内容已保存，打开画布会自动同步）'}。`,
      }],
    }
  },
)

server.tool(
  'wf_connect',
  '用箭头连接两个已有元素（绑定到形状，移动会跟随）。from/to 为 wf_draw 时的元素 id。',
  { from: z.string(), to: z.string(), label: z.string().optional() },
  async ({ from, to, label }) => {
    const ids = new Set(spec.items.map((i) => i.id))
    if (!ids.has(from) || !ids.has(to)) {
      return { content: [{ type: 'text', text: `错误：from/to 必须是已存在的元素 id（当前有：${[...ids].slice(0, 20).join(', ')}…）` }], isError: true }
    }
    const id = `${from}->${to}`
    spec.conns = spec.conns.filter((c) => c.id !== id)
    spec.conns.push({ id, from, to, ...(label ? { label } : {}) })
    broadcast()
    return { content: [{ type: 'text', text: `已连接 ${from} → ${to}${label ? `（${label}）` : ''}` }] }
  },
)

server.tool(
  'wf_update',
  '按 id 增量更新一个线稿元素（位置/尺寸/文字）。',
  {
    id: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    label: z.string().optional(),
    secondary: z.string().optional(),
    meta: z.string().optional(),
  },
  async (patch) => {
    const idx = spec.items.findIndex((x) => x.id === patch.id)
    if (idx < 0) return { content: [{ type: 'text', text: `错误：元素 ${patch.id} 不存在` }], isError: true }
    const { id: _drop, ...rest } = patch
    spec.items[idx] = { ...spec.items[idx]!, ...rest }
    broadcast()
    return { content: [{ type: 'text', text: `已更新 ${patch.id}` }] }
  },
)

server.tool(
  'wf_delete',
  '按 id 删除线稿元素（关联连线一并删除）。',
  { ids: z.array(z.string()).min(1) },
  async ({ ids }) => {
    const set = new Set(ids)
    const before = spec.items.length
    spec.items = spec.items.filter((i) => !set.has(i.id))
    spec.conns = spec.conns.filter((c) => !set.has(c.from) && !set.has(c.to))
    broadcast()
    return { content: [{ type: 'text', text: `已删除 ${before - spec.items.length} 个元素` }] }
  },
)

server.tool('wf_clear', '清空当前线稿。', {}, async () => {
  spec = emptySpec()
  broadcast()
  return { content: [{ type: 'text', text: '已清空' }] }
})

server.tool('wf_list', '列出当前线稿的屏幕与元素概览。', {}, async () => {
  const screens = spec.items.filter((i) => i.kind === 'screen')
  const lines = screens.length
    ? screens.map((s) => {
        const children = spec.items.filter((i) => i.screen === s.id)
        return `屏「${s.label ?? s.id}」(${s.id})：${children.length} 个子元素`
      })
    : [`（无 screen；散落元素 ${spec.items.length} 个）`]
  return {
    content: [{
      type: 'text',
      text: [`元素 ${spec.items.length}、连线 ${spec.conns.length}`, ...lines].join('\n'),
    }],
  }
})

server.tool(
  'wf_save',
  '把当前线稿保存为 JSON 文件（可进版本库、可 diff）。',
  { path: z.string() },
  async ({ path: p }) => {
    const abs = resolvePath(p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify(spec, null, 2), 'utf8')
    return { content: [{ type: 'text', text: `已保存 ${abs}` }] }
  },
)

server.tool(
  'wf_load',
  '从 JSON 文件加载线稿（覆盖当前内容）。',
  { path: z.string() },
  async ({ path: p }) => {
    const abs = resolvePath(p)
    const data: unknown = JSON.parse(fs.readFileSync(abs, 'utf8'))
    if (!isWireSpec(data)) return { content: [{ type: 'text', text: '错误：不是合法的 wire spec（version 1）' }], isError: true }
    spec = data
    broadcast()
    return { content: [{ type: 'text', text: `已加载 ${abs}：${spec.items.length} 个元素、${spec.conns.length} 条连线` }] }
  },
)

server.tool(
  'wf_export_svg',
  '把当前线稿无头导出为 SVG 文件（不需要画布/浏览器开着）。',
  { path: z.string() },
  async ({ path: p }) => {
    const abs = resolvePath(p)
    const svg = renderSpecSvg(spec)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, svg, 'utf8')
    return { content: [{ type: 'text', text: `已导出 ${abs}（${svg.length} 字节，${spec.items.filter((i) => i.kind === 'screen').length} 个屏幕）` }] }
  },
)

server.tool('wf_clients', '查看当前在线画布数量（原生导出/实时同步的前提）。', {}, async () => {
  return { content: [{ type: 'text', text: `在线画布 ${clients.size} 个` }] }
})

server.tool(
  'wf_get_item',
  '按 id 查看单个线稿元素的当前数据（调试/验证回传用）。',
  { id: z.string() },
  async ({ id }) => {
    const item = spec.items.find((i) => i.id === id)
    if (!item) return { content: [{ type: 'text', text: `错误：元素 ${id} 不存在` }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(item) }] }
  },
)

server.tool(
  'wf_export_native',
  '通过在线画布用 tldraw 原生渲染导出 SVG/PNG（带 tldraw 真实样式；需要画布页面开着）。画布不在线时请改用 wf_export_svg。',
  { format: z.enum(['svg', 'png']), path: z.string() },
  async ({ format, path: p }) => {
    const client = [...clients].find((c) => c.readyState === c.OPEN)
    if (!client) {
      return { content: [{ type: 'text', text: '错误：画布未连接，无法原生导出；请改用 wf_export_svg（无头）' }], isError: true }
    }
    const reqId = `x${Date.now()}${Math.floor(Math.random() * 1e6)}`
    const result = await new Promise<ExportResult>((resolve) => {
      const timer = setTimeout(() => {
        pendingExports.delete(reqId)
        resolve({ ok: false, error: '画布 10 秒未响应导出请求' })
      }, 10000)
      pendingExports.set(reqId, { resolve, timer })
      client.send(JSON.stringify({ type: 'export_request', reqId, format }))
    })
    if (!result.ok) {
      return { content: [{ type: 'text', text: `导出失败：${result.error ?? '未知错误'}` }], isError: true }
    }
    const abs = resolvePath(p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    if (format === 'svg') {
      fs.writeFileSync(abs, result.svg ?? '', 'utf8')
    } else {
      const b64 = (result.dataUrl ?? '').split(',')[1] ?? ''
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'))
    }
    return { content: [{ type: 'text', text: `已用 tldraw 原生渲染导出 ${abs}` }] }
  },
)

async function main() {
  const auto = process.env.WIRE_AUTOLOAD
  if (auto) {
    try {
      const data: unknown = JSON.parse(fs.readFileSync(resolvePath(auto), 'utf8'))
      if (isWireSpec(data)) {
        spec = data
        log(`已自动加载 ${auto}（${spec.items.length} 个元素）`)
      } else {
        log(`WIRE_AUTOLOAD 指向的文件不是合法 wire spec：${auto}`)
      }
    } catch (err) {
      log(`WIRE_AUTOLOAD 加载失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 真实 MCP 客户端退出后进程随之退出，防止残留实例占用画布桥端口；
  // 但后台/无终端方式启动时 stdin 一开始就是 EOF，此时保持常驻供画布演示。
  let hasClient = false
  process.stdin.on('data', () => {
    hasClient = true
  })
  process.stdin.on('end', () => {
    if (hasClient) process.exit(0)
  })
  log(`MCP server 就绪（stdio）；画布桥 ws://127.0.0.1:${WS_PORT}`)
}

main().catch((err) => {
  console.error('[wire-mcp] 启动失败:', err)
  process.exit(1)
})
