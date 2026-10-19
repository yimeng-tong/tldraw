/**
 * 增强功能 e2e：接管 8770 画布桥 → 等画布连接 → 等浏览器移动 s1 的写回 →
 * 持久化 → tldraw 原生导出 svg/png。
 * 运行前提：无常驻 MCP server 占用 8770；随后在浏览器打开/刷新 http://localhost:5273
 * 并执行 window.__wireEditor.updateShapes([{id:'shape:wf-s1',type:'frame',x:140,y:160}])。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const transport = new StdioClientTransport({
  command: path.join(root, 'node_modules', '.bin', 'tsx'),
  args: [path.join(root, 'server', 'mcp.ts')],
  cwd: root,
})
const client = new Client({ name: 'verify', version: '0.0.0' })
await client.connect(transport)

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args })
  return res.content?.map((c) => c.text ?? '').join('\n') ?? ''
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await call('wf_load', { path: path.join(root, 'examples', 'nomad.wire.json') })
console.log('spec 已加载，等待画布连接…')

let canvasSeen = false
for (let i = 0; i < 60; i++) {
  if ((await call('wf_clients')).includes('1 个')) {
    canvasSeen = true
    break
  }
  await sleep(1000)
}
if (!canvasSeen) {
  console.error('FAIL: 60 秒内画布未连接到本实例')
  process.exit(1)
}
console.log('画布已连接。READY — 现在请在浏览器移动 s1 → (140,160)')

let moved = false
for (let i = 0; i < 180; i++) {
  const item = JSON.parse(await call('wf_get_item', { id: 's1' }))
  if (item.x === 140 && item.y === 160) {
    moved = true
    break
  }
  await sleep(1000)
}
if (!moved) {
  console.error('FAIL: 未检测到 s1 位置写回（期望 140,160）')
  process.exit(1)
}
console.log('PASS: 画布编辑写回生效（s1 → 140,160）')

await call('wf_save', { path: path.join(root, 'exports', 'verify-writeback.json') })
const saved = JSON.parse(fs.readFileSync(path.join(root, 'exports', 'verify-writeback.json'), 'utf8'))
const s1 = saved.items.find((i) => i.id === 's1')
if (!s1 || s1.x !== 140) {
  console.error('FAIL: 写回状态落盘坐标不正确')
  process.exit(1)
}
console.log('PASS: 写回后的 spec 持久化成功')

await call('wf_export_native', { format: 'svg', path: path.join(root, 'exports', 'verify-native.svg') })
if (!fs.existsSync(path.join(root, 'exports', 'verify-native.svg')) || fs.statSync(path.join(root, 'exports', 'verify-native.svg')).size < 500) {
  console.error('FAIL: 原生 SVG 未生成或过小')
  process.exit(1)
}
await call('wf_export_native', { format: 'png', path: path.join(root, 'exports', 'verify-native.png') })
const png = fs.readFileSync(path.join(root, 'exports', 'verify-native.png'))
if (png.length < 1000) {
  console.error('FAIL: 原生 PNG 未生成或过小')
  process.exit(1)
}
console.log(`PASS: tldraw 原生导出 SVG+PNG（PNG ${png.length} 字节）`)

await client.close()
console.log('\nVERIFY OK — 写回 + 持久化 + 原生导出全链路通过')
