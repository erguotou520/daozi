/**
 * Node 直接运行 TS 时的解析钩子。
 *
 * `src/` 里的导入写成无扩展名的 TS 风格（`./score`），Vite 能解析、TypeScript 4.8 也接受；
 * 但 Node 的 ESM 解析器不会自动补 `.ts`，所以这里注册一个解析钩子。
 *
 * 用法：node --import ./scripts/ts-resolve.mjs scripts/xxx.ts
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '/index.ts']

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      for (const extension of EXTENSIONS) {
        const candidate = new URL(specifier + extension, context.parentURL)
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  }
})
