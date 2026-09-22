// Resolve extensionless relative imports (Vite style) for Node tests
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[mc]?js$/.test(specifier)) {
    try {
      const resolved = new URL(specifier, context.parentURL)
      const path = fileURLToPath(resolved)
      for (const ext of ['.js', '.mjs', '/index.js']) {
        if (existsSync(path + ext)) {
          return nextResolve(pathToFileURL(path + ext).href, context)
        }
      }
    } catch { /* fall through */ }
  }
  return nextResolve(specifier, context)
}
