<template>
  <DialogWrapper
    v-model="isOpen"
    :title="$t('previewConfig')"
    box-class="w-11/12 max-w-4xl"
    no-padding
  >
    <template #title-right>
      <span class="text-base-content/50 ml-2 text-xs font-normal">{{ filePath }}</span>
    </template>
    <div class="relative">
      <pre
        class="m-0 max-h-[70vh] overflow-auto p-4 text-xs leading-relaxed"
      ><code ref="codeRef" :class="highlightClass" v-html="highlightedContent"></code></pre>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { theme } from '@/store/settings'
import hljs from 'highlight.js/lib/core'
import ini from 'highlight.js/lib/languages/ini'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import { computed, onMounted, ref, watch } from 'vue'

// Register languages
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('toml', ini) // ini is close enough for toml

// Dark themes list
const DARK_THEMES = [
  'dark',
  'dark-legacy',
  'synthwave',
  'halloween',
  'forest',
  'black',
  'luxury',
  'dracula',
  'business',
  'night',
  'coffee',
  'dim',
  'sunset',
  'abyss',
]

const props = defineProps<{
  content: string
  filePath: string
}>()

const isOpen = defineModel<boolean>()
const codeRef = ref<HTMLElement>()
const currentThemeStyle = ref<'light' | 'dark' | null>(null)

// Check if current theme is dark
const isDark = computed(() => {
  // Check if theme is in known dark themes
  if (DARK_THEMES.includes(theme.value)) return true
  // Check if theme name contains 'dark'
  if (theme.value.toLowerCase().includes('dark')) return true
  // For custom themes, check color-scheme via CSS
  if (typeof window !== 'undefined') {
    const colorScheme = getComputedStyle(document.body).colorScheme
    if (colorScheme === 'dark') return true
  }
  return false
})

// Determine file type from path
const fileType = computed(() => {
  const path = props.filePath.toLowerCase()
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.toml')) return 'toml'
  return 'yaml' // default to yaml for clash configs
})

const highlightClass = computed(() => {
  return `hljs language-${fileType.value}`
})

// Use highlight.js for syntax highlighting
const highlightedContent = computed(() => {
  if (!props.content) return ''

  try {
    const result = hljs.highlight(props.content, {
      language: fileType.value,
      ignoreIllegals: true,
    })
    return result.value
  } catch {
    // Fallback to escaped plain text if highlighting fails
    return props.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
})

// Dynamically import highlight.js theme CSS
const loadThemeStyle = async (dark: boolean) => {
  const themeType = dark ? 'dark' : 'light'

  // Skip if already loaded
  if (currentThemeStyle.value === themeType) return

  // Remove existing style element if any
  const existingStyle = document.getElementById('hljs-theme-style')
  if (existingStyle) {
    existingStyle.remove()
  }

  // Import the appropriate theme
  if (dark) {
    await import('highlight.js/styles/atom-one-dark.css')
  } else {
    await import('highlight.js/styles/atom-one-light.css')
  }

  currentThemeStyle.value = themeType
}

onMounted(() => {
  loadThemeStyle(isDark.value)
})

// Watch theme changes
watch(isDark, (dark) => {
  loadThemeStyle(dark)
})

// Reset scroll position when content changes
watch(
  () => props.content,
  () => {
    if (codeRef.value) {
      codeRef.value.scrollTop = 0
    }
  },
)
</script>

<style scoped>
pre {
  font-family: 'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  tab-size: 2;
}

code {
  display: block;
  white-space: pre;
}

/* Override background to transparent */
:deep(.hljs) {
  background: transparent !important;
}
</style>
