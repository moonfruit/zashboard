<template>
  <form
    class="flex flex-col gap-3"
    @submit.prevent="submit"
  >
    <p
      v-if="challenge.message"
      class="text-base-content/70 text-sm"
    >
      {{ challenge.message }}
    </p>
    <p
      v-if="challenge.previousError"
      class="text-error text-sm"
    >
      {{ challenge.previousError }}
    </p>

    <div
      v-if="remaining !== undefined"
      class="font-mono text-xs tabular-nums"
      :class="remaining === 0 ? 'text-error' : 'text-base-content/60'"
    >
      {{ $t('vpnDeadline', { seconds: remaining }) }}
    </div>

    <template v-if="challenge.kind === 'credentials'">
      <label class="flex flex-col gap-1">
        <span class="text-base-content/60 text-xs">{{ $t('vpnUsername') }}</span>
        <input
          v-model="username"
          class="input input-sm input-bordered w-full"
          autocomplete="off"
          :disabled="disabled"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-base-content/60 text-xs">{{ $t('vpnPassword') }}</span>
        <input
          v-model="password"
          class="input input-sm input-bordered w-full"
          type="password"
          autocomplete="off"
          :disabled="disabled"
        />
      </label>
      <label
        v-if="challenge.secretMessage"
        class="flex flex-col gap-1"
      >
        <span class="text-base-content/60 text-xs">{{ challenge.secretMessage }}</span>
        <input
          v-model="secret"
          class="input input-sm input-bordered w-full"
          :type="challenge.echo ? 'text' : 'password'"
          autocomplete="off"
          :disabled="disabled"
        />
      </label>
    </template>

    <label
      v-else-if="challenge.kind === 'secret'"
      class="flex flex-col gap-1"
    >
      <span class="text-base-content/60 text-xs">{{
        challenge.secretMessage || $t('vpnSecret')
      }}</span>
      <input
        v-model="secret"
        class="input input-sm input-bordered w-full"
        :type="challenge.echo ? 'text' : 'password'"
        autocomplete="off"
        :disabled="disabled"
      />
    </label>

    <div class="flex items-center gap-2">
      <button
        v-if="challenge.kind === 'credentials' || challenge.kind === 'secret'"
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
  cancelOpenVPNChallenge,
  deadlineIn,
  submitOpenVPNChallenge,
  type OpenVPNChallengeView,
} from '@/assembly/singbox/tools/vpn'
import { notifyRequestError } from '@/helper/request-error'
import { useNow } from '@vueuse/core'
import { computed, ref } from 'vue'

const props = defineProps<{
  endpointTag: string
  challenge: OpenVPNChallengeView
}>()

const now = useNow({ interval: 1000 })

const username = ref(props.challenge.username)
const password = ref('')
const secret = ref('')
const phase = ref<'idle' | 'submitting' | 'submitted' | 'cancelling' | 'cancelled'>('idle')

const remaining = computed(() => deadlineIn(props.challenge, now.value.getTime() / 1000))
const disabled = computed(() => phase.value !== 'idle' || remaining.value === 0)

const submit = () => {
  phase.value = 'submitting'
  const response =
    props.challenge.kind === 'credentials'
      ? { username: username.value, password: password.value, secret: secret.value }
      : { secret: secret.value }

  submitOpenVPNChallenge(props.endpointTag, props.challenge.id, response)
    .then(() => (phase.value = 'submitted'))
    .catch((e: unknown) => {
      phase.value = 'idle'
      notifyRequestError(new Error(toolErrorMessage(e)))
    })
}

const cancel = () => {
  const previous = phase.value

  phase.value = 'cancelling'
  cancelOpenVPNChallenge(props.endpointTag, props.challenge.id)
    .then(() => (phase.value = 'cancelled'))
    .catch((e: unknown) => {
      phase.value = previous
      notifyRequestError(new Error(toolErrorMessage(e)))
    })
}
</script>
