/** 一次性把示例线稿注入正在运行的 MCP server（供画布实时显示）。 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const transport = new StdioClientTransport({
  command: path.join(root, 'node_modules', '.bin', 'tsx'),
  args: [path.join(root, 'server', 'mcp.ts')],
  cwd: root,
})
const client = new Client({ name: 'load-example', version: '0.0.0' })
await client.connect(transport)
const res = await client.callTool({
  name: 'wf_load',
  arguments: { path: path.join(root, 'examples', 'nomad.wire.json') },
})
console.log(res.content?.map((c) => c.text ?? '').join('\n'))
await client.close()
