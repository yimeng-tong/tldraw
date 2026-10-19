/**
 * 线稿数据模型 —— MCP server 与 tldraw 画布共享的唯一事实源。
 * 不依赖任何运行时（浏览器/Node 均可 import），服务端存这份 spec，
 * 画布端把它渲染成 tldraw 形状，SVG 导出器把它渲染成文件。
 */
export type WireKind =
  | 'screen'
  | 'statusbar'
  | 'navbar'
  | 'tabbar'
  | 'button'
  | 'chip'
  | 'input'
  | 'card'
  | 'list_item'
  | 'section'
  | 'text'
  | 'divider'
  | 'image'
  | 'map'

export interface WireItem {
  /** 稳定 id；MCP 增量更新、连线、画布形状都按它对齐 */
  id: string
  kind: WireKind
  /** 画布绝对坐标；screen 子组件也用绝对坐标，方便两种渲染器一致 */
  x: number
  y: number
  w?: number
  h?: number
  /** 主文字：标题 / 按钮文字 / 输入占位符 / 画板名 */
  label?: string
  /** 次行文字：卡片副标题、列表项描述 */
  secondary?: string
  /** 右侧元信息 */
  meta?: string
  /** 所属 screen 的 item id（tldraw 里嵌套进 frame） */
  screen?: string
}

export interface WireConn {
  id: string
  from: string
  to: string
  label?: string
}

export interface WireSpec {
  version: 1
  items: WireItem[]
  conns: WireConn[]
}

export const emptySpec = (): WireSpec => ({ version: 1, items: [], conns: [] })

export const isWireSpec = (v: unknown): v is WireSpec => {
  const s = v as WireSpec
  return (
    !!s &&
    s.version === 1 &&
    Array.isArray(s.items) &&
    Array.isArray(s.conns)
  )
}
