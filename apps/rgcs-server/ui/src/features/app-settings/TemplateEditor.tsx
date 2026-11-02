// 点検テンプレート editor: pick or create a template, edit its items
// (label / detail, reorder, remove), save (PUT bumps the version) or delete.
import { useEffect, useState } from 'react'
import type { InspectionItem, InspectionTemplate, InspectionTemplateInput } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../logbook/api'
import { firstIssue, templateSchema } from '../logbook/schema'

interface Props {
  readonly dict: Dict
  readonly isAdmin: boolean
}

const NEW = 0
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function move(items: readonly InspectionItem[], i: number, dir: -1 | 1): readonly InspectionItem[] {
  const j = i + dir
  if (j < 0 || j >= items.length) return items
  const next = [...items]
  next[i] = items[j]
  next[j] = items[i]
  return next
}

export function TemplateEditor({ dict, isAdmin }: Props) {
  const [templates, setTemplates] = useState<readonly InspectionTemplate[]>([])
  const [selected, setSelected] = useState<number>(1)
  const [draft, setDraft] = useState<InspectionTemplateInput>({ name: '', items: [] })
  const [version, setVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (pick: number | null) =>
    listTemplates()
      .then((t) => {
        setTemplates(t)
        const chosen = t.find((x) => x.id === (pick ?? selected)) ?? t[0]
        if (chosen) {
          setSelected(chosen.id)
          setDraft({ name: chosen.name, items: chosen.items })
          setVersion(chosen.version)
        }
      })
      .catch((e: unknown) => setError(message(e)))

  useEffect(() => {
    let live = true
    listTemplates()
      .then((t) => {
        if (!live) return
        setTemplates(t)
        const first = t[0]
        if (first) {
          setSelected(first.id)
          setDraft({ name: first.name, items: first.items })
          setVersion(first.version)
        }
      })
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [])

  const pick = (id: number) => {
    setSelected(id)
    setError(null)
    if (id === NEW) {
      setDraft({ name: '', items: [{ label: '', detail: '' }] })
      setVersion(null)
      return
    }
    const t = templates.find((x) => x.id === id)
    if (t) {
      setDraft({ name: t.name, items: t.items })
      setVersion(t.version)
    }
  }

  const setItems = (items: readonly InspectionItem[]) => setDraft({ ...draft, items: [...items] })
  const setItem = (i: number, patch: Partial<InspectionItem>) => setItems(draft.items.map((it, k) => (k === i ? { ...it, ...patch } : it)))

  const save = async () => {
    const issue = firstIssue(templateSchema.safeParse(draft))
    if (issue) return setError(`${issue.path}: ${issue.message}`)
    setBusy(true)
    setError(null)
    try {
      const saved = selected === NEW ? await createTemplate(draft) : await updateTemplate(selected, draft)
      setTemplates((prev) => (prev.some((t) => t.id === saved.id) ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved]))
      setSelected(saved.id)
      setDraft({ name: saved.name, items: saved.items })
      setVersion(saved.version)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (selected === NEW) return
    setBusy(true)
    setError(null)
    try {
      await deleteTemplate(selected)
      await load(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface" data-testid="template-card">
      <div className="row" style={{ gap: 10 }}>
        <span className="h1">{dict.lbTemplates}</span>
        {version !== null && <span className="lb-muted">{`v${version}`}</span>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <select className="in" aria-label={dict.lbTemplates} value={selected} disabled={!isAdmin} onChange={(e) => pick(Number(e.target.value))}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value={NEW}>{dict.lbNewTemplate}</option>
        </select>
      </div>
      <div className="lb-form">
        <label htmlFor="tpl-name">{dict.lbTemplateName}</label>
        <input id="tpl-name" className="in" value={draft.name} disabled={!isAdmin} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <ul className="lb-template-items">
        {draft.items.map((it, i) => (
          <li key={i} data-testid="template-item">
            <input className="in sm" aria-label={dict.lbItem} value={it.label} disabled={!isAdmin} onChange={(e) => setItem(i, { label: e.target.value })} />
            <input className="in sm" aria-label={dict.lbDetail} value={it.detail} disabled={!isAdmin} onChange={(e) => setItem(i, { detail: e.target.value })} />
            <span className="lb-inline-actions">
              <button type="button" className="btn btn-ghost sm" disabled={!isAdmin || i === 0} onClick={() => setItems(move(draft.items, i, -1))}>
                {dict.lbUp}
              </button>
              <button type="button" className="btn btn-ghost sm" disabled={!isAdmin || i === draft.items.length - 1} onClick={() => setItems(move(draft.items, i, 1))}>
                {dict.lbDown}
              </button>
              <button type="button" className="btn btn-ghost sm" disabled={!isAdmin} onClick={() => setItems(draft.items.filter((_, k) => k !== i))}>
                {dict.lbRemove}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <div className="warnbox fatal">{error}</div>}
      {isAdmin && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => setItems([...draft.items, { label: '', detail: '' }])}>
            {dict.lbAddItem}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {dict.lbSave}
          </button>
          <span className="grow" />
          {selected !== NEW && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void remove()}>
              {dict.lbDeleteTemplate}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
