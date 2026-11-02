import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// The tests assert Japanese copy: pin the UI language unless a test picks another one.
try {
  localStorage.setItem('rgcs.lang', 'ja')
} catch {
  // no storage in this environment
}

afterEach(() => cleanup())
