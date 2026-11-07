import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathKey, realPathKey } from './path-key'

test('Windows drive paths match across separators, case and trailing slashes', () => {
  assert.equal(pathKey('C:\\Dev\\App\\.git'), pathKey('c:/dev/app/.git/'))
  assert.equal(pathKey('C:/Dev//App'), 'c:/dev/app')
  assert.equal(pathKey('C:\\'), 'c:/')
})

test('UNC paths keep their leading double slash', () => {
  assert.equal(pathKey('\\\\Server\\Share\\Repo'), '//server/share/repo')
})

test('WSL UNC aliases share one key and keep the Linux path case', () => {
  assert.equal(pathKey('\\\\wsl$\\Ubuntu\\home\\Me'), pathKey('//wsl.localhost/ubuntu/home/Me'))
  assert.notEqual(pathKey('//wsl$/ubuntu/home/me'), pathKey('//wsl$/ubuntu/home/Me'))
})

test('POSIX paths keep case and backslashes, fold NFD to NFC', () => {
  assert.notEqual(pathKey('/dev/App'), pathKey('/dev/app'))
  assert.equal(pathKey('/dev/a\\b'), '/dev/a\\b')
  assert.equal(pathKey('/dev/caf\u0065\u0301/'), pathKey('/dev/caf\u00e9'))
})

test('realPathKey resolves symlinks', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'spotlight-path-'))
  try {
    mkdirSync(path.join(base, 'real'))
    symlinkSync(path.join(base, 'real'), path.join(base, 'link'))
    assert.equal(realPathKey(path.join(base, 'link')), realPathKey(path.join(base, 'real')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
