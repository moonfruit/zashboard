import { ref, shallowRef } from 'vue'

export type SingboxApiInfo = {
  version: string
  apiVersion: number
}

export type SingboxApiError = 'unauthorized' | 'unimplemented' | 'timeout' | 'network' | 'subpath'

export type SingboxRuntime = {
  startedAt: number
  goroutines: number
  connectionsIn: number
  connectionsOut: number
}

export const singboxApi = shallowRef<SingboxApiInfo>()
export const singboxApiError = ref<SingboxApiError>()
export const singboxRuntime = ref<SingboxRuntime>()
export const singboxApiModule = shallowRef<typeof import('./runtime')>()

export const resetSingboxApi = () => {
  singboxApi.value = undefined
  singboxApiError.value = undefined
  singboxRuntime.value = undefined
}
