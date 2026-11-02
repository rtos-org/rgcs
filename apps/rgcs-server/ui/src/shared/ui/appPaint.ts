// "The app has drawn its first real frame" (the operations map's first MapLibre `idle`):
// the sign-in clouds wait for it before clearing (features/auth/introStore).

const listeners = new Set<() => void>()

export function markAppPainted(): void {
  listeners.forEach((l) => l())
}

export function onAppPainted(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
