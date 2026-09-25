<template>
  <DialogWrapper
    v-model="open"
    :title="title"
  >
    <div class="flex flex-col gap-2">
      <input
        v-model="query"
        class="input input-sm w-full"
        :placeholder="$t('toolSearchOutbound')"
      />
      <div class="max-h-96 overflow-y-auto">
        <button
          class="hover:bg-base-200 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
          @click="choose('')"
        >
          <span class="flex-1">{{ $t('toolDefaultRoute') }}</span>
          <CheckIcon
            v-if="model === ''"
            class="text-primary size-4"
          />
        </button>
        <button
          v-for="option in filtered"
          :key="option.tag"
          class="hover:bg-base-200 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
          @click="choose(option.tag)"
        >
          <span class="min-w-0 flex-1 truncate">{{ option.tag }}</span>
          <span class="text-base-content/50 text-xs">{{ option.type }}</span>
          <span
            v-if="option.delay"
            class="text-base-content/60 w-14 text-right font-mono text-xs tabular-nums"
            >{{ option.delay }} ms</span
          >
          <CheckIcon
            v-if="model === option.tag"
            class="text-primary size-4"
          />
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { outboundOptions } from '@/assembly/singbox/tools/common'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { CheckIcon } from '@heroicons/vue/24/outline'
import { computed, ref, watch } from 'vue'

defineProps<{
  title: string
}>()

const open = defineModel<boolean>('open', { required: true })
const model = defineModel<string>({ required: true })
const query = ref('')

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()

  return keyword
    ? outboundOptions.value.filter((option) => option.tag.toLowerCase().includes(keyword))
    : outboundOptions.value
})

const choose = (tag: string) => {
  model.value = tag
  open.value = false
}

watch(open, (value) => {
  if (value) query.value = ''
})
</script>
