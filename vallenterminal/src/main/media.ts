import type { BrowserWindow } from 'electron'
import { dialog, protocol, net } from 'electron'
import { extname, isAbsolute } from 'path'
import { existsSync, lstatSync, openSync, readSync, closeSync } from 'fs'
import { pathToFileURL } from 'url'
import { MediaSelectResult } from '../shared/types'

const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.webm'])
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB max for video

export function isAllowedMediaFile(filePath: string): { valid: boolean; type?: 'image' | 'video' } {
  if (!filePath || !isAbsolute(filePath)) return { valid: false }
  if (!existsSync(filePath)) return { valid: false }

  try {
    const stat = lstatSync(filePath)
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { valid: false }
  } catch {
    return { valid: false }
  }

  const ext = extname(filePath).toLowerCase()
  const type = ALLOWED_IMAGE_EXTS.has(ext) ? 'image' : ALLOWED_VIDEO_EXTS.has(ext) ? 'video' : undefined
  if (!type) return { valid: false }

  const signatures: Record<string, (bytes: Buffer) => boolean> = {
    '.png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    '.jpg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    '.jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    '.gif': (b) => b.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null,
    '.webp': (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
    '.mp4': (b) => b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp',
    '.webm': (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
  }
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const header = Buffer.alloc(12)
    const bytesRead = readSync(fd, header, 0, header.length, 0)
    if (!signatures[ext](header.subarray(0, bytesRead))) return { valid: false }
  } catch {
    return { valid: false }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }

  return { valid: true, type }
}

export function registerMediaProtocol(): void {
  protocol.handle('vallen-media', async (request) => {
    try {
      if (!request.url.startsWith('vallen-media://')) {
        return new Response('Forbidden or invalid media file', { status: 403 })
      }
      const url = new URL(request.url)
      // Path after host: pathname may be /home/user/...
      let decodedPath = decodeURIComponent(url.pathname)
      // On Windows it might be /C:/..., on Unix it starts with /
      if (process.platform === 'win32' && decodedPath.startsWith('/')) {
        decodedPath = decodedPath.slice(1)
      }

      const check = isAllowedMediaFile(decodedPath)
      if (!check.valid) {
        return new Response('Forbidden or invalid media file', { status: 403 })
      }

      return await net.fetch(pathToFileURL(decodedPath).toString())
    } catch {
      return new Response('File not found', { status: 404 })
    }
  })
}

export async function selectMediaFile(window: BrowserWindow): Promise<MediaSelectResult> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Pilih Background Gambar / Video',
    properties: ['openFile'],
    filters: [
      {
        name: 'Media Files (Gambar & Video)',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']
      },
      {
        name: 'Gambar',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
      },
      {
        name: 'Video',
        extensions: ['mp4', 'webm']
      }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }

  const selectedPath = result.filePaths[0]
  const check = isAllowedMediaFile(selectedPath)

  if (!check.valid) {
    return { canceled: true }
  }

  return {
    canceled: false,
    path: selectedPath,
    type: check.type
  }
}
