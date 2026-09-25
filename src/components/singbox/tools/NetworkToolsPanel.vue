<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <section class="flex flex-col gap-1">
      <div class="settings-section-label">{{ $t('networkQuality') }}</div>
      <div class="settings-grid">
        <div class="setting-item">
          <div class="setting-item-label">{{ $t('networkQualityConfigURL') }}</div>
          <input
            v-model="nqOptions.configURL"
            class="input input-sm w-48 max-w-full sm:w-72"
            :disabled="nqRunning"
          />
        </div>
        <button
          type="button"
          class="setting-item w-full text-left"
          :disabled="nqRunning"
          @click="nqPickerOpen = true"
        >
          <div class="setting-item-label">{{ $t('outbound') }}</div>
          <span class="text-base-content/70 flex items-center gap-1 text-sm">
            {{ nqOptions.outboundTag || $t('toolDefaultRoute') }}
            <ChevronRightIcon class="size-4 opacity-40" />
          </span>
        </button>
        <div class="setting-item">
          <div class="setting-item-label">{{ $t('maxRuntime') }}</div>
          <SelectInput
            v-model="nqOptions.maxRuntimeSeconds"
            class="select select-sm min-w-24"
            :disabled="nqRunning"
            :options="maxRuntimeOptions"
          />
        </div>
        <div class="setting-item">
          <div class="setting-item-label">{{ $t('networkQualitySerial') }}</div>
          <input
            v-model="nqOptions.serial"
            type="checkbox"
            class="toggle"
            :disabled="nqRunning"
          />
        </div>
        <div class="setting-item">
          <div class="setting-item-label">HTTP/3</div>
          <input
            v-model="nqOptions.http3"
            type="checkbox"
            class="toggle"
            :disabled="nqRunning"
          />
        </div>
        <div class="setting-item">
          <button
            class="btn btn-sm ml-auto"
            :class="nqRunning ? '' : 'btn-neutral'"
            @click="toggleNetworkQuality"
          >
            <span
              v-if="nqRunning"
              class="loading loading-spinner loading-xs"
            ></span>
            {{ nqRunning ? $t('toolCancel') : $t('toolStart') }}
          </button>
        </div>
      </div>

      <div
        v-if="nqError"
        class="text-error px-1 pt-2 text-sm"
      >
        {{ nqError }}
      </div>

      <div
        v-if="nqResult"
        class="mt-2 flex flex-col gap-2"
      >
        <div class="text-base-content/60 px-1 text-xs">
          {{ $t(NQ_PHASE_KEYS[nqResult.phase]) }} · {{ (nqResult.elapsedMs / 1000).toFixed(1) }} s
        </div>
        <TimeSeriesChart
          class="bg-base-100 h-44 rounded-xl"
          :title="$t('networkQuality')"
          :data="nqChartData"
          :label-formatter="nqLabelFormatter"
          :tooltip-formatter="nqTooltipFormatter"
          :window-seconds="nqWindowSeconds"
          :show-pause-button="false"
        />
        <div class="settings-grid">
          <div
            v-for="row in nqRows"
            :key="row.label"
            class="setting-item"
          >
            <div class="setting-item-label">{{ $t(row.label) }}</div>
            <span class="flex items-baseline gap-1.5">
              <span class="font-mono text-sm tabular-nums">{{ row.value }}</span>
              <span
                v-if="row.unit"
                class="text-base-content/50 text-xs"
              >
                {{ row.unit }}
              </span>
            </span>
            <span class="flex min-w-16 shrink-0 justify-end">
              <span
                v-if="row.accuracy"
                class="badge badge-xs"
                :class="ACCURACY_BADGE[row.accuracy]"
              >
                {{ $t(ACCURACY_KEYS[row.accuracy]) }}
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-1">
      <div class="settings-section-label">{{ $t('stunTest') }}</div>
      <div class="settings-grid">
        <div class="setting-item">
          <div class="setting-item-label">{{ $t('stunServer') }}</div>
          <input
            v-model="stunServer"
            class="input input-sm w-48 max-w-full sm:w-64"
            :disabled="stunRunning"
          />
        </div>
        <button
          type="button"
          class="setting-item w-full text-left"
          :disabled="stunRunning"
          @click="stunPickerOpen = true"
        >
          <div class="setting-item-label">{{ $t('outbound') }}</div>
          <span class="text-base-content/70 flex items-center gap-1 text-sm">
            {{ stunOutboundTag || $t('toolDefaultRoute') }}
            <ChevronRightIcon class="size-4 opacity-40" />
          </span>
        </button>
        <div class="setting-item">
          <button
            class="btn btn-sm ml-auto"
            :class="stunRunning ? '' : 'btn-neutral'"
            @click="toggleStun"
          >
            <span
              v-if="stunRunning"
              class="loading loading-spinner loading-xs"
            ></span>
            {{ stunRunning ? $t('toolCancel') : $t('toolStart') }}
          </button>
        </div>
      </div>

      <div
        v-if="stunError"
        class="text-error px-1 pt-2 text-sm"
      >
        {{ stunError }}
      </div>

      <template v-if="stunResult">
        <div class="settings-grid mt-2">
          <div class="setting-item">
            <div class="setting-item-label">{{ $t('stunExternalAddress') }}</div>
            <div class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 truncate text-right text-sm">
                {{ stunResult.externalAddr || '-' }}
              </span>
              <button
                v-if="stunResult.externalAddr"
                type="button"
                class="btn btn-ghost btn-xs"
                :aria-label="$t('copy')"
                @click="copy(stunResult.externalAddr)"
              >
                <component
                  :is="copied ? ClipboardDocumentCheckIcon : ClipboardDocumentIcon"
                  class="size-4"
                />
              </button>
            </div>
          </div>
          <div class="setting-item">
            <div class="setting-item-label">{{ $t('stunLatency') }}</div>
            <span class="text-sm">
              {{ stunResult.latencyMs > 0 ? `${stunResult.latencyMs} ms` : '-' }}
            </span>
          </div>
          <template v-if="stunResult.isFinal && !stunResult.natTypeSupported">
            <div class="setting-item">
              <div class="setting-item-label">{{ $t('stunNatUnsupported') }}</div>
            </div>
          </template>
          <template v-else>
            <div class="setting-item">
              <div class="setting-item-label">{{ $t('stunNatMapping') }}</div>
              <span
                class="text-sm font-medium"
                :class="NAT_TONE_CLASS[natTone(stunResult.natMapping)]"
              >
                {{ $t(NAT_KEYS[stunResult.natMapping]) }}
              </span>
            </div>
            <div class="setting-item">
              <div class="setting-item-label">{{ $t('stunNatFiltering') }}</div>
              <span
                class="text-sm font-medium"
                :class="NAT_TONE_CLASS[natTone(stunResult.natFiltering)]"
              >
                {{ $t(NAT_KEYS[stunResult.natFiltering]) }}
              </span>
            </div>
          </template>
        </div>
      </template>
    </section>

    <OutboundPickerDialog
      v-model:open="nqPickerOpen"
      v-model="nqOptions.outboundTag"
      :title="$t('outbound')"
    />
    <OutboundPickerDialog
      v-model:open="stunPickerOpen"
      v-model="stunOutboundTag"
      :title="$t('outbound')"
    />
  </div>
</template>

<script setup lang="ts">
import { toolErrorMessage, type StreamingRun } from '@/assembly/singbox/tools/common'
import {
  appendThroughput,
  NETWORK_QUALITY_DEFAULTS,
  startNetworkQualityTest,
  type Accuracy,
  type NetworkQualityResult,
  type ThroughputPoint,
} from '@/assembly/singbox/tools/network-quality'
import {
  natTone,
  startStunTest,
  STUN_DEFAULT_SERVER,
  type NatBehavior,
  type NatTone,
  type StunResult,
} from '@/assembly/singbox/tools/stun'
import { formatTimeSeriesTooltipParam } from '@/components/charts/chart-tooltip'
import type {
  CartesianChartPoint,
  ChartSeries,
  ChartTooltipParam,
} from '@/components/charts/chart-types'
import TimeSeriesChart from '@/components/charts/TimeSeriesChart.vue'
import SelectInput from '@/components/common/SelectInput.vue'
import { activeUuid } from '@/store/setup'
import {
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
} from '@heroicons/vue/24/outline'
import { useClipboard } from '@vueuse/core'
import { computed, onDeactivated, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import OutboundPickerDialog from './OutboundPickerDialog.vue'

const { t } = useI18n()
const { copy, copied } = useClipboard()

const NQ_PHASE_KEYS: Record<NetworkQualityResult['phase'], string> = {
  idle: 'networkQualityIdle',
  download: 'networkQualityDownloading',
  upload: 'networkQualityUploading',
  done: 'networkQualityDone',
}

const ACCURACY_KEYS: Record<Accuracy, string> = {
  low: 'accuracyLow',
  medium: 'accuracyMedium',
  high: 'accuracyHigh',
}

const ACCURACY_BADGE: Record<Accuracy, string> = {
  high: 'badge-success',
  medium: 'badge-warning',
  low: 'badge-ghost',
}

const NAT_KEYS: Record<NatBehavior, string> = {
  unknown: 'natUnknown',
  endpointIndependent: 'natEndpointIndependent',
  addressDependent: 'natAddressDependent',
  addressAndPortDependent: 'natAddressAndPortDependent',
}

const NAT_TONE_CLASS: Record<NatTone, string> = {
  good: 'text-success',
  fair: 'text-warning',
  poor: 'text-error',
  unknown: 'text-base-content/60',
}

const maxRuntimeOptions = computed(() => [
  { value: 0, label: t('default') },
  ...[10, 20, 30, 60].map((value) => ({ value, label: `${value}s` })),
])

const nqOptions = reactive({ ...NETWORK_QUALITY_DEFAULTS })
const nqResult = shallowRef<NetworkQualityResult>()
const nqError = ref('')
const nqRun = shallowRef<StreamingRun>()
const nqRunning = computed(() => !!nqRun.value)
const nqHistory = shallowRef<ThroughputPoint[]>([])
const nqStartedAt = ref(0)
const nqWindowSeconds = ref(21)
const nqPickerOpen = ref(false)

const nqRows = computed(() => {
  const result = nqResult.value
  if (!result) return []
  return [
    {
      label: 'networkQualityDownload',
      value: result.downloadMbps.toFixed(1),
      unit: 'Mbps',
      accuracy: result.accuracy.downloadCapacity,
    },
    {
      label: 'networkQualityUpload',
      value: result.uploadMbps.toFixed(1),
      unit: 'Mbps',
      accuracy: result.accuracy.uploadCapacity,
    },
    {
      label: 'networkQualityDownloadRPM',
      value: String(result.downloadRPM),
      unit: 'RPM',
      accuracy: result.accuracy.downloadRPM,
    },
    {
      label: 'networkQualityUploadRPM',
      value: String(result.uploadRPM),
      unit: 'RPM',
      accuracy: result.accuracy.uploadRPM,
    },
    {
      label: 'networkQualityIdleLatency',
      value: String(result.idleLatencyMs),
      unit: 'ms',
      accuracy: undefined as Accuracy | undefined,
    },
  ]
})

const nqLabelFormatter = (value: number) => `${value.toFixed(0)} Mbps`

const nqChartData = computed<ChartSeries[]>(() => [
  {
    name: t('networkQualityUpload'),
    data: nqHistory.value.map(
      (point) => [nqStartedAt.value + point.elapsedMs, point.uploadMbps] as CartesianChartPoint,
    ),
  },
  {
    name: t('networkQualityDownload'),
    data: nqHistory.value.map(
      (point) => [nqStartedAt.value + point.elapsedMs, point.downloadMbps] as CartesianChartPoint,
    ),
  },
])

const nqTooltipFormatter = (params: ChartTooltipParam[]) =>
  params
    .map((item) => formatTimeSeriesTooltipParam(item, (value) => `${value.toFixed(1)} Mbps`))
    .join('')

const toggleNetworkQuality = () => {
  if (nqRun.value) {
    nqRun.value.cancel()
    return
  }

  nqResult.value = undefined
  nqError.value = ''
  nqHistory.value = []
  nqStartedAt.value = Date.now()
  nqWindowSeconds.value = (nqOptions.maxRuntimeSeconds || 60) + 1

  const current = startNetworkQualityTest({ ...nqOptions }, (result) => {
    if (nqRun.value !== current) return
    nqResult.value = result
    if (result.error) nqError.value = result.error
    if (result.phase !== 'done') nqHistory.value = appendThroughput(nqHistory.value, result)
  })

  nqRun.value = current
  current.done
    .catch((e: unknown) => {
      if (nqRun.value === current) nqError.value = toolErrorMessage(e)
    })
    .finally(() => {
      if (nqRun.value === current) nqRun.value = undefined
    })
}

const stunServer = ref(STUN_DEFAULT_SERVER)
const stunOutboundTag = ref('')
const stunResult = shallowRef<StunResult>()
const stunError = ref('')
const stunRun = shallowRef<StreamingRun>()
const stunRunning = computed(() => !!stunRun.value)
const stunPickerOpen = ref(false)

const toggleStun = () => {
  if (stunRun.value) {
    stunRun.value.cancel()
    return
  }

  stunResult.value = undefined
  stunError.value = ''

  const current = startStunTest(
    { server: stunServer.value, outboundTag: stunOutboundTag.value },
    (result) => {
      if (stunRun.value !== current) return
      stunResult.value = result
      if (result.error) stunError.value = result.error
    },
  )

  stunRun.value = current
  current.done
    .catch((e: unknown) => {
      if (stunRun.value === current) stunError.value = toolErrorMessage(e)
    })
    .finally(() => {
      if (stunRun.value === current) stunRun.value = undefined
    })
}

watch(activeUuid, () => {
  nqRun.value?.cancel()
  stunRun.value?.cancel()
  nqRun.value = undefined
  stunRun.value = undefined
  nqResult.value = undefined
  nqHistory.value = []
  nqError.value = ''
  stunResult.value = undefined
  stunError.value = ''
})

onUnmounted(() => {
  nqRun.value?.cancel()
  stunRun.value?.cancel()
})

onDeactivated(() => {
  nqPickerOpen.value = false
  stunPickerOpen.value = false
})
</script>
