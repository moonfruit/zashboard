<template>
  <form
    class="flex flex-col gap-3"
    @submit.prevent="submit"
  >
    <p
      v-if="challenge.banner"
      class="text-base-content/70 text-sm whitespace-pre-wrap"
    >
      {{ challenge.banner }}
    </p>
    <p
      v-if="challenge.message"
      class="text-base-content/70 text-sm"
    >
      {{ challenge.message }}
    </p>
    <p
      v-if="challenge.error"
      class="text-error text-sm"
    >
      {{ challenge.error }}
    </p>

    <template v-if="challenge.type === 'form'">
      <label
        v-for="field in challenge.fields.filter((field) => field.kind !== 'hidden')"
        :key="field.key"
        class="flex flex-col gap-1"
      >
        <span class="text-base-content/60 text-xs">{{ field.label }}</span>
        <select
          v-if="field.kind === 'select'"
          v-model="values[field.key]"
          class="select select-sm select-bordered w-full"
          :disabled="disabled"
        >
          <option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <input
          v-else
          v-model="values[field.key]"
          :type="field.kind"
          class="input input-sm input-bordered w-full"
          autocomplete="off"
          :disabled="disabled"
        />
      </label>
    </template>

    <template v-else-if="challenge.type === 'browser'">
      <a
        v-if="challenge.url"
        :href="challenge.url"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-sm self-start"
      >
        {{ $t('vpnOpenUrl') }}
      </a>
      <p class="text-base-content/60 text-xs">{{ $t('vpnBrowserUnsupported') }}</p>
    </template>

    <div class="flex items-center gap-2">
      <button
        v-if="challenge.type === 'form'"
        type="submit"
        class="btn btn-primary btn-sm"
        :disabled="disabled"
      >
        <span
          v-if="phase === 'submitting'"
          class="loading loading-spinner loading-xs"
        />
        {{ $t('vpnSubmit') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="phase !== 'idle' && phase !== 'submitted'"
        @click="cancel"
      >
        <span
          v-if="phase === 'cancelling'"
          class="loading loading-spinner loading-xs"
        />
        {{ $t('vpnCancelChallenge') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { toolErrorMessage } from '@/assembly/singbox/tools/common'
import {
  cancelOpenConnectChallenge,
  initialFormValues,
  submitOpenConnectForm,
  type OpenConnectChallengeView,
} from '@/assembly/singbox/tools/vpn'
import { notifyRequestError } from '@/helper/request-error'
import { computed, ref } from 'vue'

const props = defineProps<{
  endpointTag: string
  challenge: OpenConnectChallengeView
}>()

const values = ref<Record<string, string>>(
  props.challenge.type === 'form' ? initialFormValues(props.challenge.fields) : {},
)
const phase = ref<'idle' | 'submitting' | 'submitted' | 'cancelling' | 'cancelled'>('idle')
const disabled = computed(() => phase.value !== 'idle')

const submit = () => {
  phase.value = 'submitting'
  submitOpenConnectForm(props.endpointTag, props.challenge.id, { ...values.value })
    .then(() => (phase.value = 'submitted'))
    .catch((e: unknown) => {
      phase.value = 'idle'
      notifyRequestError(new Error(toolErrorMessage(e)))
    })
}

const cancel = () => {
  const previous = phase.value

  phase.value = 'cancelling'
  cancelOpenConnectChallenge(props.endpointTag, props.challenge.id)
    .then(() => (phase.value = 'cancelled'))
    .catch((e: unknown) => {
      phase.value = previous
      notifyRequestError(new Error(toolErrorMessage(e)))
    })
}
</script>
