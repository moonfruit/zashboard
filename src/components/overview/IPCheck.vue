<template>
  <div class="bg-base-200/30 flex flex-col rounded-xl p-4">
    <div class="flex items-center justify-between">
      <div class="text-base-content/60 text-xs font-semibold tracking-wider uppercase">
        {{ $t('networkInfo') }}
      </div>
      <div class="flex gap-1">
        <button
          class="btn btn-ghost btn-xs btn-circle"
          @click="showPrivacy = !showPrivacy"
          @mouseenter="handlerShowPrivacyTip"
        >
          <EyeIcon
            v-if="showPrivacy"
            class="h-3.5 w-3.5"
          />
          <EyeSlashIcon
            v-else
            class="h-3.5 w-3.5"
          />
        </button>
        <button
          class="btn btn-ghost btn-xs btn-circle"
          @click="getIPs"
        >
          <BoltIcon class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div class="mt-2 flex flex-col gap-2">
      <template
        v-for="(slot, index) in slots"
        :key="slot.key"
      >
        <div
          v-if="index > 0"
          class="border-base-content/5 border-t"
        />
        <div>
          <SelectInput
            v-model="slot.api.value"
            class="select-ghost select-xs h-6 min-h-6 w-auto border-0"
            :aria-label="`${t('IPInfoAPI')} ${index + 1}`"
            :options="apiOptions"
          />
          <div class="mt-1 text-sm">
            {{ showPrivacy ? slot.result.value.ipWithPrivacy[0] : slot.result.value.ip[0] }}
            <span
              v-if="slot.result.value.ip[1]"
              class="text-base-content/60 text-xs"
            >
              ({{ showPrivacy ? slot.result.value.ipWithPrivacy[1] : slot.result.value.ip[1] }})
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import SelectInput from '@/components/common/SelectInput.vue'
import type { IPInfo } from '@/api/geoip'
import {
  forkIPCheckSlots,
  getIPCheckInfo,
  ipCheckAPIOptions,
  type IPCheckAPI,
} from '@/assembly/overview-fork/ip-check'
import { ipCheckPrimaryResult, ipCheckSecondaryResult, type IPCheckResult } from '@/helper/overview'
import { IP_INFO_API } from '@/constant'
import { useTooltip } from '@/composables/use-tooltip'
import { autoIPCheck, ipCheckPrimaryAPI, ipCheckSecondaryAPI } from '@/store/settings'
import { BoltIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'
import * as ipaddr from 'ipaddr.js'
import type { Ref } from 'vue'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showPrivacy = ref(false)
const { showTip } = useTooltip()
const handlerShowPrivacyTip = (e: Event) => {
  showTip(e, t('ipScreenshotTip'))
}
const apiOptions = ipCheckAPIOptions

type Slot = { key: string; api: Ref<IPCheckAPI>; result: Ref<IPCheckResult> }
const slots: Slot[] = [
  { key: 'primary', api: ipCheckPrimaryAPI, result: ipCheckPrimaryResult },
  { key: 'secondary', api: ipCheckSecondaryAPI, result: ipCheckSecondaryResult },
  ...forkIPCheckSlots,
]
const requestIDs: Record<string, number> = {}

const queryingResult = (api: IPCheckAPI): IPCheckResult => ({
  api,
  ip: [t('getting'), ''],
  ipWithPrivacy: [t('getting'), ''],
  info: null,
})

const failedResult = (api: IPCheckAPI): IPCheckResult => ({
  api,
  ip: [t('testFailed'), ''],
  ipWithPrivacy: [t('testFailed'), ''],
  info: null,
})

const maskIP = (value: string) => {
  if (!ipaddr.isValid(value)) return '***.***.***.***'

  const address = ipaddr.parse(value)

  if (address.kind() === 'ipv4') return '***.***.***.***'

  const parts = address.toNormalizedString().split(':')
  return `${parts[0]}:${parts[1]}:****:****`
}

const distinct = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
]

const displayLabel = (info: IPInfo, api: IPCheckAPI) => {
  if (api === IP_INFO_API.IPIP) {
    return distinct([info.country, info.region, info.city, info.organization]).join(' ')
  }

  return distinct([info.country, info.organization]).join(' ') || info.ip
}

const successResult = (info: IPInfo, api: IPCheckAPI): IPCheckResult => {
  const label = displayLabel(info, api)
  const privateLabel = api === IP_INFO_API.IPIP ? `${info.country || '**'} ** ** **` : label

  return {
    api,
    ipWithPrivacy: [label, info.ip],
    ip: [privateLabel, maskIP(info.ip)],
    info,
  }
}

const querySlot = async ({ key, api: apiRef, result: resultRef }: Slot) => {
  const api = apiRef.value
  const requestID = (requestIDs[key] = (requestIDs[key] ?? 0) + 1)
  resultRef.value = queryingResult(api)

  try {
    const info = await getIPCheckInfo(api)

    if (requestID !== requestIDs[key] || api !== apiRef.value) return
    resultRef.value = successResult(info, api)
  } catch {
    if (requestID !== requestIDs[key] || api !== apiRef.value) return
    resultRef.value = failedResult(api)
  }
}

const getIPs = () => {
  slots.forEach((slot) => void querySlot(slot))
}

slots.forEach((slot) => watch(slot.api, () => void querySlot(slot)))

onMounted(() => {
  if (!autoIPCheck.value) return

  slots.forEach((slot) => {
    if (slot.result.value.ip.length === 0 || slot.result.value.api !== slot.api.value) {
      void querySlot(slot)
    }
  })
})
</script>
