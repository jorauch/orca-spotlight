// The handful of vitest matchers the ported engine tests use, on node:assert.
import assert from 'node:assert/strict'

type ErrorClass = new (...args: never[]) => Error

function matches(actual: unknown, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual((actual as Record<string, unknown>)?.[key], value, `property ${key}`)
  }
}

export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.equal(actual, expected),
    toBeNull: () => assert.equal(actual, null),
    toThrow: () => assert.throws(actual as () => unknown),
    not: {
      toBe: (expected: unknown) => assert.notEqual(actual, expected),
      toBeNull: () => assert.notEqual(actual, null)
    },
    rejects: {
      toThrow: (errorClass: ErrorClass) => assert.rejects(actual as Promise<unknown>, errorClass),
      toBeInstanceOf: (errorClass: ErrorClass) =>
        assert.rejects(actual as Promise<unknown>, errorClass),
      toMatchObject: (expected: Record<string, unknown>) =>
        assert.rejects(actual as Promise<unknown>, (error: unknown) => {
          matches(error, expected)
          return true
        })
    }
  }
}
