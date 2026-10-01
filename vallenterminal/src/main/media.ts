import { dialog, BrowserWindow, protocol, net } from 'electron'
import { extname, isAbsolute } from 'path'
import { existsSync, statSync } from 'fs'
import { pathToFileURL } from 'url'
import { MediaSelectResult } from '../shared/types'

const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.webm'])
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB max for video

export function isAllowedMediaFile(filePath: string): { valid: boolean; type?: 'image' | 'video' } {
  if (!filePath || !isAbsolute(filePath)) return { valid: false }
  if (!existsSync(filePath)) return { valid: false }

  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { valid: false }
  } catch {
    return { valid: false }
  }

  const ext = extname(filePath).toLowerCase()
  if (ALLOWED_IMAGE_EXTS.has(ext)) return { valid: true, type: 'image' }
  if (ALLOWED_VIDEO_EXTS.has(ext)) return { valid: true, type: 'video' }

  return { valid: false }
}

export function registerMediaProtocol(): void {
  protocol.handle('vallen-media', async (request) => {
    try {
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
