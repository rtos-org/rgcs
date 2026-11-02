import { describe, expect, it } from 'vitest'
import { ownsKey } from './editorKeys'

const el = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild as HTMLElement
}
const key = (k: string, meta = false) => ({ key: k, metaKey: meta, ctrlKey: false })

describe('ownsKey (keys the focused element keeps from the editor shortcuts)', () => {
  it('a text field keeps every key, ⌘Z included (its own undo)', () => {
    for (const t of [el('<input type="text">'), el('<textarea></textarea>'), el('<select></select>'), el('<div role="slider"></div>')]) {
      expect(ownsKey(t, key('z', true))).toBe(true)
      expect(ownsKey(t, key('Backspace'))).toBe(true)
    }
  })

  it('a button lets undo / redo and Escape through (⌘Z right after clicking Undo), and keeps the rest', () => {
    const b = el('<button>Undo</button>')
    expect(ownsKey(b, key('z', true))).toBe(false)
    expect(ownsKey(b, key('Z', true))).toBe(false)
    expect(ownsKey(b, key('Escape'))).toBe(false)
    expect(ownsKey(el('<input type="checkbox">'), key('z', true))).toBe(false)
    // no accidental deletes or nudges from a focused control
    expect(ownsKey(b, key('Delete'))).toBe(true)
    expect(ownsKey(b, key('Enter'))).toBe(true)
    expect(ownsKey(el('<div role="radio"></div>'), key('ArrowLeft'))).toBe(true)
    expect(ownsKey(b, key('v', true))).toBe(true)
  })

  it('the survey panel keeps its keys; the map and the list do not', () => {
    const inPanel = el('<div class="survey-panel"><span>x</span></div>').firstElementChild!
    expect(ownsKey(inPanel, key('Delete'))).toBe(true)
    expect(ownsKey(el('<div tabindex="0"></div>'), key('Delete'))).toBe(false)
    expect(ownsKey(null, key('z', true))).toBe(false)
  })
})
