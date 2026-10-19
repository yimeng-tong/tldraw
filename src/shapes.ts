/**
 * 把 WireSpec 构建成 tldraw 形状（只在浏览器端 import；用到 tldraw 运行时 API）。
 * 关键 API 约定（tldraw v3）：
 * - 稳定 id 必须用 createShapeId('xxx')，字面量 id 会抛错
 * - 文字一律 props.richText = toRichText('...')，旧的 props.text 会校验失败
 * - 矩形/椭圆等都是 type:'geo' + props.geo 区分
 */
import { createShapeId, toRichText, type TLShape } from 'tldraw'
import type { WireItem, WireSpec } from '../shared/spec'

const sid = (s: string) => createShapeId('wf-' + s)

interface TextOpts {
  size?: 's' | 'm' | 'l'
  color?: 'black' | 'grey'
}

function textShape(id: string, x: number, y: number, str: string, o: TextOpts = {}): TLShape {
  return {
    id: sid(id),
    type: 'text',
    x,
    y,
    props: {
      richText: toRichText(str),
      size: o.size ?? 's',
      color: o.color ?? 'black',
      font: 'sans',
    },
  } as TLShape
}

interface GeoOpts {
  geo?: 'rectangle' | 'ellipse' | 'line'
  w?: number
  h?: number
  color?: 'black' | 'grey'
  dash?: 'solid' | 'draw'
  label?: string
  labelColor?: 'black' | 'grey'
  align?: 'start' | 'middle' | 'end'
  size?: 's' | 'm' | 'l'
  parentId?: string
}

function geoShape(id: string, x: number, y: number, o: GeoOpts = {}): TLShape {
  const props: Record<string, unknown> = {
    geo: o.geo ?? 'rectangle',
    w: o.w ?? 120,
    h: o.h ?? 32,
    color: o.color ?? 'black',
    fill: 'none',
    dash: o.dash ?? 'solid',
    size: o.size ?? 's',
    font: 'sans',
  }
  if (o.label !== undefined) {
    props.richText = toRichText(o.label)
    props.labelColor = o.labelColor ?? 'black'
    props.align = o.align ?? 'middle'
    props.verticalAlign = 'middle'
  }
  return {
    id: sid(id),
    type: 'geo',
    x,
    y,
    ...(o.parentId ? { parentId: sid(o.parentId) } : {}),
    props,
  } as TLShape
}

function renderItem(it: WireItem): TLShape[] {
  const shapes: TLShape[] = []
  const w = it.w ?? 120
  const h = it.h ?? 32
  const parent = it.screen
  switch (it.kind) {
    case 'screen':
      shapes.push({
        id: sid(it.id),
        type: 'frame',
        x: it.x,
        y: it.y,
        props: { w, h, name: it.label ?? it.id },
      } as TLShape)
      break
    case 'statusbar':
      shapes.push(textShape(it.id, it.x, it.y, it.label ?? '', { color: 'grey' }))
      break
    case 'navbar':
      shapes.push(textShape(it.id + '-back', it.x, it.y, '＜', { size: 'm' }))
      if (it.label)
        shapes.push(textShape(it.id + '-title', it.x + 64, it.y - 2, it.label, { size: 'm' }))
      if (it.meta)
        shapes.push(textShape(it.id + '-meta', it.x + w - 150, it.y, it.meta, { color: 'grey' }))
      shapes.push(geoShape(it.id + '-line', it.x - 12, it.y + 40, { w: w + 24, h: 2, color: 'grey' }))
      break
    case 'tabbar':
      shapes.push(geoShape(it.id + '-line', it.x, it.y, { w, h: 2, color: 'grey' }))
      if (it.label) shapes.push(textShape(it.id + '-t1', it.x + 8, it.y + 14, it.label))
      if (it.secondary) shapes.push(textShape(it.id + '-t2', it.x + w / 2 - 28, it.y + 14, it.secondary, { color: 'grey' }))
      if (it.meta) shapes.push(textShape(it.id + '-t3', it.x + w - 64, it.y + 14, it.meta, { color: 'grey' }))
      break
    case 'button':
      shapes.push(geoShape(it.id, it.x, it.y, { w, h, label: it.label }))
      break
    case 'chip':
      shapes.push(geoShape(it.id, it.x, it.y, { w, h, color: 'grey', label: it.label, labelColor: 'grey' }))
      break
    case 'input':
      shapes.push(geoShape(it.id, it.x, it.y, { w, h, color: 'grey', label: 'Q ' + (it.label ?? ''), labelColor: 'grey', align: 'start' }))
      break
    case 'card':
      shapes.push(geoShape(it.id + '-box', it.x, it.y, { w, h, parentId: parent }))
      if (it.label) shapes.push(textShape(it.id + '-title', it.x + 14, it.y + 12, it.label, { size: 'm' }))
      if (it.secondary) shapes.push(textShape(it.id + '-sub', it.x + 14, it.y + 40, it.secondary, { color: 'grey' }))
      if (it.meta) shapes.push(textShape(it.id + '-meta', it.x + w - 130, it.y + 12, it.meta, { color: 'grey' }))
      break
    case 'list_item':
      if (it.label) shapes.push(textShape(it.id + '-title', it.x, it.y, it.label))
      if (it.secondary) shapes.push(textShape(it.id + '-sub', it.x, it.y + 20, it.secondary, { color: 'grey' }))
      if (it.meta) shapes.push(textShape(it.id + '-meta', it.x + (it.w ?? 260) - 80, it.y, it.meta, { color: 'grey' }))
      break
    case 'section':
      shapes.push(textShape(it.id, it.x, it.y, it.label ?? '', { size: 'm' }))
      break
    case 'text':
      shapes.push(textShape(it.id, it.x, it.y, it.label ?? ''))
      break
    case 'divider':
      shapes.push(geoShape(it.id, it.x, it.y, { w, h: 2, color: 'grey' }))
      break
    case 'image':
    case 'map':
      shapes.push(
        geoShape(it.id, it.x, it.y, {
          w,
          h,
          color: 'grey',
          dash: 'draw',
          label: it.label ?? (it.kind === 'map' ? '地图' : '图'),
          labelColor: 'grey',
        }),
      )
      break
  }
  // 除 screen 自身外，全部挂到所属 frame 下
  if (parent && it.kind !== 'screen' && it.kind !== 'card') {
    for (const s of shapes) {
      if (!('parentId' in s)) (s as { parentId?: unknown }).parentId = sid(parent)
    }
  }
  return shapes
}

function renderConn(c: { id: string; from: string; to: string }, byId: Map<string, WireItem>): TLShape | null {
  const a = byId.get(c.from)
  const b = byId.get(c.to)
  if (!a || !b) return null
  // 该版本箭头端点必须是页面坐标数字；取起点右缘中点 → 终点左缘中点
  const x1 = a.x + (a.w ?? 120)
  const y1 = a.y + (a.h ?? 32) / 2
  const x2 = b.x
  const y2 = b.y + (b.h ?? 32) / 2
  return {
    id: sid('conn-' + c.id),
    type: 'arrow',
    x: x1,
    y: y1,
    props: {
      color: 'grey',
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
    },
  } as TLShape
}

export function buildShapes(spec: WireSpec): TLShape[] {
  const shapes: TLShape[] = []
  // frame 先建，保证子形状的 parentId 存在
  for (const s of spec.items.filter((i) => i.kind === 'screen')) shapes.push(...renderItem(s))
  for (const i of spec.items.filter((i) => i.kind !== 'screen')) shapes.push(...renderItem(i))
  const byId = new Map(spec.items.map((i) => [i.id, i] as const))
  for (const c of spec.conns) {
    const arrow = renderConn(c, byId)
    if (arrow) shapes.push(arrow)
  }
  return shapes
}

export { sid as wireShapeId }
