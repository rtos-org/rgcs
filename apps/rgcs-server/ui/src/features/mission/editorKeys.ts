// Which key events the mission editor's shortcuts (Delete, ⌘Z, arrows…) must leave alone: every key
// typed in a field, every key on a control except undo / redo and Escape (so ⌘Z works right after
// clicking the header's Undo, while Delete on a focused button never deletes waypoints), and
// anything inside the survey panel.
const FIELD_TAGS = ['SELECT', 'TEXTAREA']
const FIELD_ROLES = ['slider', 'spinbutton', 'textbox', 'combobox']
const CONTROL_ROLES = ['button', 'radio', 'checkbox', 'switch', 'menuitem', 'tab']
const INPUT_CONTROLS = ['button', 'submit', 'reset', 'checkbox', 'radio']
interface KeyLike {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

/** ⌘Z / ⌘⇧Z and Escape: harmless to pass on from a focused control. */
const passesControls = (e: KeyLike): boolean => e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')

function isField(t: HTMLElement): boolean {
  if (t.tagName === 'INPUT') return !INPUT_CONTROLS.includes((t as HTMLInputElement).type)
  return FIELD_TAGS.includes(t.tagName) || t.isContentEditable || FIELD_ROLES.includes(t.getAttribute('role') ?? '')
}

function isControl(t: HTMLElement): boolean {
  return t.tagName === 'BUTTON' || t.tagName === 'INPUT' || CONTROL_ROLES.includes(t.getAttribute('role') ?? '')
}

export function ownsKey(t: EventTarget | null, e: KeyLike): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (isField(t) || t.closest('.survey-panel') !== null) return true
  return isControl(t) && !passesControls(e)
}
