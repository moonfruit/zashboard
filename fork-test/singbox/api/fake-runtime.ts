import { singboxApiModule } from '@/assembly/singbox/api/state'

type Meta = { firstOfConnection: boolean }

export const fakeShared = <T>() => {
  const listeners = new Set<(value: T, meta: Meta) => void>()

  return {
    subscribe(listener: (value: T, meta: Meta) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retryNow() {},
    emit(value: T, meta: Meta = { firstOfConnection: false }) {
      listeners.forEach((listener) => listener(value, meta))
    },
    size: () => listeners.size,
  }
}

export const installRuntime = (partial: Record<string, unknown>) => {
  singboxApiModule.value = partial as unknown as typeof singboxApiModule.value
}
