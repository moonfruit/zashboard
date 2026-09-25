<template>
  <DialogWrapper
    v-model="isOpen"
    :title="peerDisplayName(peer)"
  >
    <template #title-right>
      <span
        class="badge badge-sm ml-2"
        :class="peer.online ? 'badge-success' : 'badge-ghost'"
      >
        {{ peer.online ? $t('connected') : $t('notConnected') }}
      </span>
    </template>

    <div class="flex flex-col gap-4 text-sm">
      <section class="flex flex-col gap-1">
        <div class="text-base-content/45 px-1 text-xs">{{ $t('addresses') }}</div>
        <div class="divide-base-content/8 bg-base-200/40 divide-y overflow-hidden rounded-xl">
          <CopyLine
            v-if="magicDNS"
            label="MagicDNS"
            :value="magicDNS"
          />
          <CopyLine
            :label="$t('hostnameLabel')"
            :value="peer.hostName"
          />
          <CopyLine
            v-if="ipv4"
            label="IPv4"
            :value="ipv4"
          />
          <CopyLine
            v-if="ipv6"
            label="IPv6"
            :value="ipv6"
          />
        </div>
      </section>

      <section
        v-if="!isSelf && peer.online"
        class="flex flex-col gap-1"
      >
        <div class="flex items-center justify-between">
          <span class="text-base-content/45 px-1 text-xs">{{ $t('ping') }}</span>
          <button
            class="btn btn-ghost btn-xs"
            :title="pingRunning ? $t('pingStop') : $t('pingStart')"
            :aria-label="pingRunning ? $t('pingStop') : $t('pingStart')"
            @click="pingRunning ? stopPing() : startPing()"
          >
            <component
              :is="pingRunning ? StopIcon : PlayIcon"
              class="h-4 w-4"
            />
          </button>
        </div>
        <div
          v-if="pingError"
          class="text-error px-1 py-1 break-all"
        >
          {{ pingError }}
        </div>
        <template v-if="latest">
          <div class="divide-base-content/8 bg-base-200/40 divide-y overflow-hidden rounded-xl">
            <DataRow :label="latencyLabel(latest)">{{ latest.latencyMs.toFixed(1) }} ms</DataRow>
            <DataRow
              v-if="pingPath(latest) === 'direct' && latest.endpoint"
              :label="$t('endpointLabel')"
            >
              {{ latest.endpoint }}
            </DataRow>
            <DataRow
              v-if="pingPath(latest) === 'relay' && latest.peerRelay"
              :label="$t('peerRelay')"
            >
              {{ latest.peerRelay }}
            </DataRow>
            <DataRow
              v-if="pingPath(latest) === 'derp' && latest.derpRegionCode"
              :label="$t('derpRegion')"
            >
              {{ latest.derpRegionCode }}
            </DataRow>
          </div>
          <PingSparkline
            :data="pingHistory"
            :color="pingPath(latest) === 'direct' ? 'var(--color-success)' : 'var(--color-info)'"
            class="text-primary mt-1"
          />
        </template>
        <div
          v-else-if="pingRunning"
          class="py-1 opacity-60"
        >
          {{ $t('connecting') }}
        </div>
        <div
          v-else-if="!pingError"
          class="py-1 opacity-60"
        >
          {{ $t('noData') }}
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <div class="text-base-content/45 px-1 text-xs">{{ $t('detailsLabel') }}</div>
        <div class="divide-base-content/8 bg-base-200/40 divide-y overflow-hidden rounded-xl">
          <DataRow
            v-if="peer.os"
            :label="$t('osLabel')"
          >
            {{ peer.os }}
          </DataRow>
          <DataRow :label="$t('keyExpiry')">{{ keyExpiryText }}</DataRow>
          <DataRow
            v-if="!peer.online && peer.lastSeen > 0"
            :label="$t('lastSeen')"
          >
            {{ fromNow(peer.lastSeen * 1000) }}
          </DataRow>
          <DataRow
            v-if="peer.rxBytes > 0 || peer.txBytes > 0"
            :label="$t('traffic')"
          >
            ↓ {{ prettyBytesHelper(peer.rxBytes) }} ↑ {{ prettyBytesHelper(peer.txBytes) }}
          </DataRow>
          <DataRow
            v-if="peer.exitNodeOption"
            :label="$t('exitNode')"
          >
            {{ peer.exitNode ? $t('activeLabel') : $t('availableLabel') }}
          </DataRow>
          <DataRow
            v-if="peer.shareeNode"
            :label="$t('sharedIn')"
          >
            {{ $t('yes') }}
          </DataRow>
        </div>
      </section>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { toolErrorMessage, type StreamingRun } from '@/assembly/singbox/tools/common'
import {
  PING_HISTORY,
  pingPath,
  startTailscalePing,
  type PingPath,
  type TailscaleEndpointView,
  type TailscalePeerView,
  type TailscalePingSample,
} from '@/assembly/singbox/tools/tailscale'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import PingSparkline from '@/components/singbox/tools/PingSparkline.vue'
import { showNotification } from '@/helper/notification'
import { fromNow, prettyBytesHelper } from '@/helper/utils'
import { DocumentDuplicateIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'
import { useClipboard } from '@vueuse/core'
import {
  computed,
  defineComponent,
  h,
  onDeactivated,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  endpoint: TailscaleEndpointView
  peer: TailscalePeerView
  isSelf: boolean
}>()
const isOpen = defineModel<boolean>()

const { t } = useI18n()
const { copy } = useClipboard()

const peerDisplayName = (peer: TailscalePeerView) =>
  peer.hostName || peer.dnsName.split('.')[0] || peer.ips[0] || ''

const DataRow = defineComponent({
  props: { label: String },
  setup:
    (rowProps, { slots }) =>
    () =>
      h('div', { class: 'flex min-h-11 items-center justify-between gap-3 px-4 py-2' }, [
        h('span', { class: 'text-base-content/55' }, rowProps.label),
        h('span', { class: 'text-right break-all' }, slots.default?.()),
      ]),
})

const copyValue = (value?: string) => {
  if (!value) return
  copy(value)
  showNotification({ content: 'copySuccess', type: 'alert-success', timeout: 2000 })
}

const CopyLine = defineComponent({
  props: { label: String, value: String },
  setup: (lineProps) => () =>
    h('div', { class: 'flex min-h-11 items-center justify-between gap-3 px-4 py-2' }, [
      h('span', { class: 'text-base-content/55' }, lineProps.label),
      h('div', { class: 'flex items-center gap-2' }, [
        h('span', { class: 'text-right break-all' }, lineProps.value),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-xs btn-circle shrink-0',
            onClick: () => copyValue(lineProps.value),
            title: t('copy'),
            'aria-label': t('copy'),
          },
          h(DocumentDuplicateIcon, { class: 'h-4 w-4' }),
        ),
      ]),
    ]),
})

const magicDNS = computed(() => props.peer.dnsName.replace(/\.$/, ''))
const ipv4 = computed(() => props.peer.ips.find((address) => !address.includes(':')))
const ipv6 = computed(() => props.peer.ips.find((address) => address.includes(':')))

const keyExpiryText = computed(() => {
  if (props.peer.expired) return t('expired')
  if (props.peer.keyExpiry > 0) return fromNow(props.peer.keyExpiry * 1000)
  return t('disabledLabel')
})

const PATH_LABEL_KEY: Record<PingPath, string> = {
  direct: 'directConnection',
  relay: 'peerRelay',
  derp: 'derpRelayed',
  unknown: 'ping',
}

const latencyLabel = (sample: TailscalePingSample) => t(PATH_LABEL_KEY[pingPath(sample)])

const run = shallowRef<StreamingRun>()
const pingRunning = computed(() => !!run.value)
const pingError = ref('')
const samples = shallowRef<TailscalePingSample[]>([])
const latest = computed(() => samples.value[samples.value.length - 1])
const pingHistory = computed(() => samples.value.map((sample) => sample.latencyMs))

const startPing = () => {
  resetPing()
  const current = startTailscalePing(props.endpoint.tag, props.peer.ips[0] ?? '', (sample) => {
    if (sample.error) {
      pingError.value = sample.error
      return
    }
    pingError.value = ''
    const next = [...samples.value, sample]
    samples.value = next.length > PING_HISTORY ? next.slice(next.length - PING_HISTORY) : next
  })
  run.value = current
  current.done
    .catch((e: unknown) => {
      if (run.value === current) pingError.value = toolErrorMessage(e)
    })
    .finally(() => {
      if (run.value === current) run.value = undefined
    })
}

const stopPing = () => {
  run.value?.cancel()
  run.value = undefined
}

const resetPing = () => {
  stopPing()
  pingError.value = ''
  samples.value = []
}

watch(isOpen, (open) => {
  if (!open) resetPing()
})

watch(
  () => props.peer.stableID,
  () => resetPing(),
)

onUnmounted(stopPing)
onDeactivated(resetPing)
</script>
