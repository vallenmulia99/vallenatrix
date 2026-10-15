import { Buffer } from 'buffer'
import { chmodSync, lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const MAX_PASTE_BYTES = 2 * 1024 * 1024

export interface SavedPaste {
  path: string
  lines: number
  characters: number
}

export function savePastedText(homeDir: string, text: string): SavedPaste {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_PASTE_BYTES) throw new Error('Pasted text is too large (maximum 2 MiB).')

  const appDirectory = join(homeDir, '.vallenatrix')
  const directory = join(appDirectory, 'pastes')
  mkdirSync(appDirectory, { recursive: true, mode: 0o700 })
  if (!lstatSync(appDirectory).isDirectory()) throw new Error('Paste storage directory must not be a symlink.')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!lstatSync(directory).isDirectory()) throw new Error('Paste storage directory must not be a symlink.')
  chmodSync(directory, 0o700)

  let path = ''
  for (let sequence = 1; sequence <= 100; sequence++) {
    path = join(directory, `vallenatrix_paste_${Date.now()}_${sequence}.txt`)
    try {
      writeFileSync(path, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        path = ''
        continue
      }
      throw error
    }
    path = ''
  }
  if (!path) throw new Error('Could not allocate a unique paste file.')

  try {
    chmodSync(path, 0o600)
    const lines = text ? text.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(text) ? 1 : 0) : 0
    return { path, lines, characters: text.length }
  } catch (error) {
    try { unlinkSync(path) } catch {}
    throw error
  }
}
