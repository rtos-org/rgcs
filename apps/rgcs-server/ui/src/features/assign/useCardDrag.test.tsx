import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCardDrag, type CardDragOptions } from './useCardDrag'

type Payload = { plan: number }

function Board(props: { opts: CardDragOptions<Payload>; onCardClick?: () => void }) {
  const drag = useCardDrag<Payload>(props.opts)
  return (
    <div>
      <button data-testid="card" {...drag.dragProps({ plan: 7 })} onClick={props.onCardClick}>plan</button>
      <div data-testid="ok" data-drop="1"><span data-testid="ok-inner">v1</span></div>
      <div data-testid="no" data-drop="2">v2</div>
      <output data-testid="state">
        {JSON.stringify({ dragging: drag.dragging, over: drag.over, reason: drag.overReason })}
      </output>
    </div>
  )
}

function state() {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}')
}

function setup(extra: Partial<CardDragOptions<Payload>> = {}) {
  const onDrop = vi.fn()
  const canDrop = vi.fn((_p: Payload, target: string) => (target === '2' ? 'wrong kind' : null))
  const onCardClick = vi.fn()
  render(<Board opts={{ onDrop, canDrop, ...extra }} onCardClick={onCardClick} />)
  return { onDrop, canDrop, onCardClick, card: screen.getByTestId('card') }
}

let under: Element | null = null
const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 }
const touch = { pointerType: 'touch', pointerId: 2, button: 0 }

function at(x: number, y: number) {
  return { clientX: x, clientY: y }
}

beforeEach(() => {
  vi.useFakeTimers()
  under = null
  document.elementFromPoint = vi.fn(() => under)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCardDrag', () => {
  it('mouse_starts_after_4px', () => {
    const { card } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    fireEvent.pointerMove(window, { ...mouse, ...at(103, 100) })
    expect(state().dragging).toBeNull()
    fireEvent.pointerMove(window, { ...mouse, ...at(106, 100) })
    expect(state().dragging).toEqual({ plan: 7 })
  })

  it('touch_needs_a_250ms_hold', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    const { card } = setup()
    fireEvent.pointerDown(card, { ...touch, ...at(100, 100) })
    act(() => { vi.advanceTimersByTime(200) })
    expect(state().dragging).toBeNull()
    act(() => { vi.advanceTimersByTime(60) })
    expect(state().dragging).toEqual({ plan: 7 })
    expect(vibrate).toHaveBeenCalledWith(12)
  })

  it('touch_move_before_hold_is_a_scroll', () => {
    const { card } = setup()
    fireEvent.pointerDown(card, { ...touch, ...at(100, 100) })
    fireEvent.pointerMove(window, { ...touch, ...at(100, 115) })
    act(() => { vi.advanceTimersByTime(400) })
    expect(state().dragging).toBeNull()
  })

  it('drop_on_a_target_calls_onDrop', () => {
    const { card, onDrop } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    under = screen.getByTestId('ok-inner')
    fireEvent.pointerMove(window, { ...mouse, ...at(200, 200) })
    expect(state().over).toBe('1')
    fireEvent.pointerUp(window, { ...mouse, ...at(200, 200) })
    expect(onDrop).toHaveBeenCalledWith({ plan: 7 }, '1')
    expect(state().dragging).toBeNull()
  })

  it('cannot_targets_are_not_dropped_on', () => {
    const { card, onDrop } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    under = screen.getByTestId('no')
    fireEvent.pointerMove(window, { ...mouse, ...at(200, 200) })
    expect(state().over).toBeNull()
    expect(state().reason).toBe('wrong kind')
    fireEvent.pointerUp(window, { ...mouse, ...at(200, 200) })
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('the_click_after_a_drag_is_suppressed', () => {
    const { card, onCardClick } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    fireEvent.pointerMove(window, { ...mouse, ...at(120, 100) })
    fireEvent.pointerUp(window, { ...mouse, ...at(120, 100) })
    fireEvent.click(card)
    expect(onCardClick).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(10) })
    fireEvent.click(card)
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('a_plain_click_is_not_suppressed', () => {
    const { card, onCardClick } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    fireEvent.pointerUp(window, { ...mouse, ...at(100, 100) })
    fireEvent.click(card)
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('touchmove_is_prevented_only_while_dragging', () => {
    const { card } = setup()
    const before = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    fireEvent.pointerDown(card, { ...touch, ...at(100, 100) })
    act(() => { vi.advanceTimersByTime(260) })
    const during = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
    fireEvent.pointerUp(window, { ...touch, ...at(100, 100) })
    const after = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('escape_cancels', () => {
    const { card, onDrop } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    under = screen.getByTestId('ok')
    fireEvent.pointerMove(window, { ...mouse, ...at(200, 200) })
    expect(state().over).toBe('1')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(state().dragging).toBeNull()
    fireEvent.pointerUp(window, { ...mouse, ...at(200, 200) })
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('pointercancel_ends_without_a_drop', () => {
    const { card, onDrop } = setup()
    fireEvent.pointerDown(card, { ...mouse, ...at(100, 100) })
    under = screen.getByTestId('ok')
    fireEvent.pointerMove(window, { ...mouse, ...at(200, 200) })
    fireEvent.pointerCancel(window, { ...mouse })
    expect(state().dragging).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('auto_scrolls_near_the_container_edges', () => {
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300 }) as DOMRect
    const { card } = setup({ scrollRef: { current: box } })
    fireEvent.pointerDown(card, { ...mouse, ...at(10, 300) })
    fireEvent.pointerMove(window, { ...mouse, ...at(10, 480) })
    expect(box.scrollTop).toBeGreaterThan(0)
    const down = box.scrollTop
    fireEvent.pointerMove(window, { ...mouse, ...at(10, 300) })
    expect(box.scrollTop).toBe(down)
    box.remove()
  })

  it('removes_its_document_listeners_on_unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const onDrop = vi.fn()
    const { unmount } = render(<Board opts={{ onDrop, canDrop: () => null }} />)
    unmount()
    expect(remove).toHaveBeenCalledWith('touchmove', expect.any(Function))
    remove.mockRestore()
  })
})
