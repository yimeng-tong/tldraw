/**
 * 无头 SVG 渲染器：只依赖 shared/spec，Node 里直接跑。
 * MCP 的 wf_export_svg 用它导出文件，不要求画布开着。
 */
import type { WireItem, WireSpec } from './spec'

const INK = '#1f2328'
const GREY = '#6a737d'
const LIGHT = '#d0d7de'
const BG = '#ffffff'

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const textWidth = (s: string, size: number): number => {
  let w = 0
  for (const ch of s) w += /[\x00-\xff]/.test(ch) ? size * 0.55 : size
  return w
}

const n = (v: number): number => Math.round(v * 10) / 10

const rect = (
  x: number, y: number, w: number, h: number,
  opts: { rx?: number; stroke?: string; dash?: string; fill?: string; width?: number } = {},
): string => {
  const { rx = 0, stroke = LIGHT, dash, fill = BG, width = 1.2 } = opts
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
}

const line = (x1: number, y1: number, x2: number, y2: number, stroke = LIGHT, width = 1.2): string =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${width}"/>`

const txt = (
  x: number, y: number, s: string,
  opts: { size?: number; fill?: string; bold?: boolean; anchor?: 'start' | 'middle' | 'end' } = {},
): string => {
  const { size = 12, fill = INK, bold = false, anchor = 'start' } = opts
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${bold ? ' font-weight="600"' : ''}>${esc(s)}</text>`
}

function renderItem(it: WireItem): string[] {
  const p: string[] = []
  const w = it.w ?? 120
  const h = it.h ?? 32
  switch (it.kind) {
    case 'screen':
      p.push(rect(it.x, it.y, w, h, { rx: 16, stroke: INK, width: 2 }))
      p.push(txt(it.x, it.y - 8, it.label ?? '', { size: 13, bold: true }))
      break
    case 'statusbar':
      p.push(txt(it.x, it.y + 12, it.label ?? '', { size: 11, fill: GREY }))
      break
    case 'navbar': {
      p.push(txt(it.x + 4, it.y + 24, '＜', { size: 16 }))
      const t = it.label ?? ''
      p.push(txt(it.x + w / 2, it.y + 24, t, { size: 15, anchor: 'middle', bold: true }))
      if (it.meta) p.push(txt(it.x + w - 6, it.y + 22, it.meta, { size: 12, fill: GREY, anchor: 'end' }))
      p.push(line(it.x, it.y + 40, it.x + w, it.y + 40))
      break
    }
    case 'tabbar': {
      p.push(line(it.x, it.y, it.x + w, it.y))
      const cy = it.y + 26
      if (it.label) p.push(txt(it.x + 28, cy, it.label, { size: 12, fill: INK, anchor: 'middle' }))
      if (it.secondary) p.push(txt(it.x + w / 2, cy, it.secondary, { size: 12, fill: GREY, anchor: 'middle' }))
      if (it.meta) p.push(txt(it.x + w - 36, cy, it.meta, { size: 12, fill: GREY, anchor: 'middle' }))
      break
    }
    case 'button':
      p.push(rect(it.x, it.y, w, h, { rx: h / 2, stroke: INK }))
      p.push(txt(it.x + w / 2, it.y + h / 2 + 4, it.label ?? '', { size: 13, anchor: 'middle' }))
      break
    case 'chip':
      p.push(rect(it.x, it.y, w, h, { rx: h / 2, stroke: GREY, fill: '#f6f8fa' }))
      p.push(txt(it.x + w / 2, it.y + h / 2 + 4, it.label ?? '', { size: 11, fill: GREY, anchor: 'middle' }))
      break
    case 'input':
      p.push(rect(it.x, it.y, w, h, { rx: 10 }))
      p.push(txt(it.x + 34, it.y + h / 2 + 4, it.label ?? '', { size: 12, fill: GREY }))
      if (it.meta) p.push(txt(it.x + w - 10, it.y + h / 2 + 4, it.meta, { size: 12, fill: GREY, anchor: 'end' }))
      p.push(txt(it.x + 12, it.y + h / 2 + 4, 'Q', { size: 12, fill: GREY }))
      break
    case 'card': {
      p.push(rect(it.x, it.y, w, h, { rx: 12 }))
      if (it.label) p.push(txt(it.x + 14, it.y + 24, it.label, { size: 14, bold: true }))
      if (it.secondary) p.push(txt(it.x + 14, it.y + 46, it.secondary, { size: 12, fill: GREY }))
      if (it.meta) p.push(txt(it.x + w - 14, it.y + 24, it.meta, { size: 12, fill: GREY, anchor: 'end' }))
      break
    }
    case 'list_item':
      if (it.label) p.push(txt(it.x, it.y + 14, it.label, { size: 13 }))
      if (it.secondary) p.push(txt(it.x, it.y + 34, it.secondary, { size: 11, fill: GREY }))
      if (it.meta) p.push(txt(it.x + (it.w ?? 260), it.y + 14, it.meta, { size: 11, fill: GREY, anchor: 'end' }))
      break
    case 'section':
      p.push(txt(it.x, it.y + 14, it.label ?? '', { size: 13, bold: true }))
      break
    case 'text':
      p.push(txt(it.x, it.y + 14, it.label ?? '', { size: 12 }))
      break
    case 'divider':
      p.push(line(it.x, it.y, it.x + w, it.y))
      break
    case 'image':
    case 'map': {
      p.push(rect(it.x, it.y, w, h, { rx: 8, stroke: GREY, dash: '6 4', fill: '#fbfcfd' }))
      const label = it.label ?? (it.kind === 'map' ? '地图' : '图')
      p.push(txt(it.x + w / 2, it.y + h / 2 + 4, label, { size: 12, fill: GREY, anchor: 'middle' }))
      break
    }
  }
  return p
}

function renderConn(spec: WireSpec, cx: number, cy: number, tx: number, ty: number, label?: string): string {
  const p: string[] = []
  const midX = (cx + tx) / 2
  const midY = (cy + ty) / 2
  p.push(`<path d="M ${n(cx)} ${n(cy)} C ${n(cx + 40)} ${n(cy)}, ${n(tx - 40)} ${n(ty)}, ${n(tx)} ${n(ty)}" fill="none" stroke="${GREY}" stroke-width="1.4" marker-end="url(#arr)"/>`)
  if (label) p.push(txt(midX, midY - 6, label, { size: 11, fill: GREY, anchor: 'middle' }))
  void spec
  return p.join('')
}

/** 把整份线稿 spec 渲染为单幅 SVG 字符串 */
export function renderSpecSvg(spec: WireSpec): string {
  const body: string[] = []
  const screens = spec.items.filter((i) => i.kind === 'screen')
  const others = spec.items.filter((i) => i.kind !== 'screen')

  for (const s of screens) body.push(...renderItem(s))
  for (const o of others) body.push(...renderItem(o))

  const byId = new Map(spec.items.map((i) => [i.id, i] as const))
  for (const c of spec.conns) {
    const a = byId.get(c.from)
    const b = byId.get(c.to)
    if (!a || !b) continue
    const ax = a.x + (a.w ?? 0)
    const ay = a.y + (a.h ?? 32) / 2
    const bx = b.x
    const by = b.y + (b.h ?? 32) / 2
    body.push(renderConn(spec, ax, ay, bx, by, c.label))
  }

  // 视口：包住全部 screen（没有 screen 时包住全部元素）
  const boundsItems = screens.length ? screens : spec.items
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const it of boundsItems) {
    minX = Math.min(minX, it.x)
    minY = Math.min(minY, it.y - 26)
    maxX = Math.max(maxX, it.x + (it.w ?? 0))
    maxY = Math.max(maxY, it.y + (it.h ?? 32))
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100 }
  const pad = 48
  const x = minX - pad, y = minY - pad
  const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" font-family="PingFang SC, Hiragino Sans GB, Helvetica, sans-serif">`,
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${GREY}"/></marker></defs>`,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${BG}"/>`,
    ...body,
    `</svg>`,
  ].join('\n')
}
