import { can } from '@/assembly/backend'
import { proxyGroupList, proxyMap } from '@/assembly/proxies/state'
import { useStorage } from '@/composables/use-storage'
import { GLOBAL } from '@/constant'
import { computed } from 'vue'

export const customGlobalNode = useStorage('config/custom-global-node-name', GLOBAL)

export const customGlobalNodeOptions = computed(() => [
  ...(proxyMap.value[GLOBAL] ? [GLOBAL] : []),
  ...proxyGroupList.value,
])

export const effectiveGlobalNode = computed({
  get: () =>
    can('customGlobalNode') && proxyMap.value[customGlobalNode.value]
      ? customGlobalNode.value
      : GLOBAL,
  set: (value: string) => {
    customGlobalNode.value = value
  },
})
