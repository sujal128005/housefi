// Static server for the studio. Serves the app repository root so the studio can load three.js and the app's fonts.
// Usage: node serve.mjs [port]  →  http://127.0.0.1:5178/tools/icons3d/studio.html#svc_tap
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.webp': 'image/webp' }

export function serve(port = 5178) {
  const server = createServer(async (req, res) => {
    const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    if (!path.startsWith(root) || !(await stat(path).catch(() => null))?.isFile()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(await readFile(path))
  })
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 5178)
  await serve(port)
  console.log(`Studio: http://127.0.0.1:${port}/tools/icons3d/studio.html#svc_tap`)
}
