// Adapted from stablyai/orca PR #7067 (MIT, see NOTICE.md): cross-platform-path.ts, without the
// WSL distro helpers. Comparison keys only — never use a key as, or splice it into, a real path.
import { realpathSync } from 'node:fs'

function isWindowsAbsolutePathLike(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('//')
}

function collapseSlashes(value: string): string {
  return value.includes('//') ? value.replace(/\/+/g, '/') : value
}

function normalizeSeparators(value: string): string {
  const normalized = collapseSlashes(value.includes('\\') ? value.replace(/\\/g, '/') : value)
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    return `//${normalized.replace(/^\/+/, '')}`
  }
  return normalized
}

function trimTrailingSlash(value: string): string {
  if (!value.endsWith('/') || value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value
  }
  return value.replace(/\/+$/, '')
}

/**
 * The same file spelled differently yields the same key: NFC (macOS hands out NFD), collapsed
 * and trailing slashes, and on Windows drive/UNC paths `\` vs `/` and letter case. POSIX paths
 * keep their case and backslashes, since both are significant there.
 */
export function pathKey(rawValue: string): string {
  const value = rawValue.normalize('NFC')
  const isWindowsPath = isWindowsAbsolutePathLike(value)
  const normalized = trimTrailingSlash(
    isWindowsPath ? normalizeSeparators(value) : collapseSlashes(value)
  )
  const wslUnc = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/[\s\S]*)?$/i)
  if (wslUnc) {
    // Two UNC aliases front the same case-sensitive WSL filesystem.
    return `//wsl/${wslUnc[1].toLowerCase()}${wslUnc[2] ?? ''}`
  }
  return isWindowsPath ? normalized.toLowerCase() : normalized
}

/** Like `pathKey`, after resolving symlinks (e.g. macOS /tmp -> /private/tmp) when it exists. */
export function realPathKey(path: string): string {
  try {
    return pathKey(realpathSync(path))
  } catch {
    return pathKey(path)
  }
}
