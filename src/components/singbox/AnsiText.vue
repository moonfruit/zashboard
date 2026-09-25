<template>
  <template
    v-for="(part, index) in parts"
    :key="index"
  >
    <mark
      v-if="part.matched"
      class="rounded-xs bg-yellow-300 text-black"
    >
      {{ part.text }}
    </mark>
    <span
      v-else
      :class="part.classes"
      :style="part.style"
      >{{ part.text }}</span
    >
  </template>
</template>

<script setup lang="ts">
import {
  highlightSegments,
  matchedRanges,
  stripAnsi,
  type AnsiSegment,
} from '@/assembly/singbox/ansi'
import { getSearchTextParts } from '@/helper/search'
import { computed } from 'vue'

const props = defineProps<{
  segments: AnsiSegment[]
  text: string
  filter: string
}>()

const FG = [
  'text-base-content/60',
  'text-error',
  'text-success',
  'text-warning',
  'text-info',
  'text-secondary',
  'text-accent',
  'text-base-content',
  'text-base-content/80',
  'text-error',
  'text-success',
  'text-warning',
  'text-info',
  'text-secondary',
  'text-accent',
  'text-base-content',
]

const BG = [
  'bg-base-300',
  'bg-error/30',
  'bg-success/30',
  'bg-warning/30',
  'bg-info/30',
  'bg-secondary/30',
  'bg-accent/30',
  'bg-base-200',
  'bg-base-300',
  'bg-error/30',
  'bg-success/30',
  'bg-warning/30',
  'bg-info/30',
  'bg-secondary/30',
  'bg-accent/30',
  'bg-base-200',
]

const paletteIndex = (color?: string) =>
  color?.startsWith('ansi-') ? Number(color.slice(5)) : undefined

const parts = computed(() => {
  const segments =
    stripAnsi(props.segments) === props.text ? props.segments : [{ text: props.text }]
  const ranges = matchedRanges(getSearchTextParts(props.text, props.filter))

  return highlightSegments(segments, ranges).map((segment) => {
    const fg = paletteIndex(segment.fg)
    const bg = paletteIndex(segment.bg)

    return {
      text: segment.text,
      matched: segment.matched,
      classes: [
        fg !== undefined && FG[fg],
        bg !== undefined && BG[bg],
        segment.bold && 'font-bold',
        segment.dim && 'opacity-60',
        segment.italic && 'italic',
        segment.underline && 'underline',
      ],
      style: {
        color: fg === undefined ? segment.fg : undefined,
        backgroundColor: bg === undefined ? segment.bg : undefined,
      },
    }
  })
})
</script>
