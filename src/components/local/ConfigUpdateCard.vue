<template>
  <div class="flex flex-col gap-2 p-4 text-sm">
    <div class="settings-title">{{ $t('configUpdate') }}</div>

    <!-- Config URL -->
    <div class="flex flex-col gap-1">
      <div class="setting-item-label">{{ $t('configUrl') }}</div>
      <div class="flex items-center gap-2">
        <input
          v-model="urlEditValue"
          class="input input-sm flex-1"
          type="url"
          :placeholder="$t('configUrlPlaceholder')"
          :disabled="!isUrlEditing"
          :class="{ 'bg-base-200': !isUrlEditing }"
        />
        <template v-if="!isUrlEditing">
          <button
            class="btn btn-ghost btn-sm btn-square"
            @click="startEditUrl"
          >
            <PencilIcon class="h-4 w-4" />
          </button>
        </template>
        <template v-else>
          <button
            class="btn btn-success btn-sm btn-square"
            @click="acceptUrlEdit"
          >
            <CheckIcon class="h-4 w-4" />
          </button>
          <button
            class="btn btn-error btn-sm btn-square"
            @click="rejectUrlEdit"
          >
            <XMarkIcon class="h-4 w-4" />
          </button>
        </template>
      </div>
    </div>

    <!-- Config Path -->
    <div class="flex flex-col gap-1">
      <div class="setting-item-label">{{ $t('configPath') }}</div>
      <div class="flex items-center gap-2">
        <input
          v-model="pathEditValue"
          class="input input-sm flex-1"
          type="text"
          :placeholder="$t('configPathPlaceholder')"
          :disabled="!isPathEditing"
          :class="{ 'bg-base-200': !isPathEditing }"
        />
        <template v-if="!isPathEditing">
          <button
            class="btn btn-ghost btn-sm btn-square"
            @click="startEditPath"
          >
            <PencilIcon class="h-4 w-4" />
          </button>
        </template>
        <template v-else>
          <button
            class="btn btn-success btn-sm btn-square"
            @click="acceptPathEdit"
          >
            <CheckIcon class="h-4 w-4" />
          </button>
          <button
            class="btn btn-error btn-sm btn-square"
            @click="rejectPathEdit"
          >
            <XMarkIcon class="h-4 w-4" />
          </button>
        </template>
      </div>
    </div>

    <!-- File Status -->
    <div class="divider my-1"></div>
    <div class="text-base-content/70 text-xs">{{ $t('configFileStatus') }}</div>
    <div
      v-if="fileInfo.exists"
      class="bg-base-200 grid gap-2 rounded-lg p-3"
    >
      <div class="flex items-center gap-2">
        <DocumentTextIcon class="h-4 w-4 shrink-0" />
        <span class="text-base-content/70 text-xs break-all">{{ fileInfo.path }}</span>
      </div>
      <div class="flex flex-wrap gap-4 text-xs">
        <span>
          <span class="text-base-content/50">{{ $t('fileSize') }}:</span>
          {{ formatFileSize(fileInfo.size) }}
        </span>
        <span>
          <span class="text-base-content/50">{{ $t('lastModified') }}:</span>
          {{ formatDateTime(fileInfo.lastModified) }}
        </span>
      </div>
    </div>
    <div
      v-else-if="configPath"
      class="text-warning text-xs"
    >
      {{ $t('configFileNotFound') }}
    </div>
    <div
      v-else
      class="text-base-content/50 text-xs"
    >
      {{ $t('configPathEmpty') }}
    </div>

    <!-- Actions -->
    <div class="divider my-1"></div>
    <div class="flex flex-wrap gap-2">
      <button
        class="btn btn-primary btn-sm"
        :disabled="isUpdating || !configUrl || !configPath"
        @click="handleUpdateConfig"
      >
        <span
          v-if="isUpdating"
          class="loading loading-spinner loading-sm"
        ></span>
        {{ $t('updateConfig') }}
      </button>
      <button
        class="btn btn-sm"
        :disabled="!fileInfo.exists"
        @click="handlePreviewConfig"
      >
        <EyeIcon class="h-4 w-4" />
        {{ $t('previewConfig') }}
      </button>
    </div>

    <!-- Preview Modal -->
    <ConfigPreviewModal
      v-model="showPreviewModal"
      :content="previewContent"
      :file-path="configPath"
    />
  </div>
</template>

<script setup lang="ts">
import ConfigPreviewModal from '@/components/local/ConfigPreviewModal.vue'
import { showNotification } from '@/helper/notification'
import { configPath, configUrl } from '@/store/settings'
import {
  CheckIcon,
  DocumentTextIcon,
  EyeIcon,
  PencilIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { onMounted, ref, watch } from 'vue'

// Wails bindings
import {
  DownloadConfig,
  GetConfigFileInfo,
  ReadConfigFile,
  UpdateConfigFile,
} from '@wailsjs/go/main/App'

interface FileInfo {
  path: string
  size: number
  lastModified: string
  exists: boolean
}

const fileInfo = ref<FileInfo>({
  path: '',
  size: 0,
  lastModified: '',
  exists: false,
})

const isUpdating = ref(false)
const showPreviewModal = ref(false)
const previewContent = ref('')

// Editable URL state
const isUrlEditing = ref(false)
const urlEditValue = ref('')

// Editable Path state
const isPathEditing = ref(false)
const pathEditValue = ref('')

// URL edit functions
const startEditUrl = () => {
  urlEditValue.value = configUrl.value
  isUrlEditing.value = true
}

const acceptUrlEdit = () => {
  configUrl.value = urlEditValue.value
  isUrlEditing.value = false
}

const rejectUrlEdit = () => {
  urlEditValue.value = configUrl.value
  isUrlEditing.value = false
}

// Path edit functions
const startEditPath = () => {
  pathEditValue.value = configPath.value
  isPathEditing.value = true
}

const acceptPathEdit = () => {
  configPath.value = pathEditValue.value
  isPathEditing.value = false
  refreshFileInfo()
}

const rejectPathEdit = () => {
  pathEditValue.value = configPath.value
  isPathEditing.value = false
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDateTime = (isoString: string): string => {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleString()
}

const refreshFileInfo = async () => {
  if (!configPath.value) {
    fileInfo.value = { path: '', size: 0, lastModified: '', exists: false }
    return
  }
  try {
    fileInfo.value = await GetConfigFileInfo(configPath.value)
  } catch {
    fileInfo.value = { path: configPath.value, size: 0, lastModified: '', exists: false }
  }
}

const handleUpdateConfig = async () => {
  if (isUpdating.value || !configUrl.value || !configPath.value) return

  isUpdating.value = true
  try {
    // Download config from URL
    const result = await DownloadConfig(configUrl.value)

    // Update config file (includes validation)
    await UpdateConfigFile(result.tempPath, configPath.value)

    // Refresh file info
    await refreshFileInfo()

    showNotification({
      content: 'configUpdateSuccess',
      type: 'alert-success',
    })
  } catch (error) {
    showNotification({
      content: 'configUpdateFailed',
      type: 'alert-error',
    })
    console.error('Config update failed:', error)
  } finally {
    isUpdating.value = false
  }
}

const handlePreviewConfig = async () => {
  if (!configPath.value || !fileInfo.value.exists) return

  try {
    previewContent.value = await ReadConfigFile(configPath.value)
    showPreviewModal.value = true
  } catch (error) {
    showNotification({
      content: 'configReadFailed',
      type: 'alert-error',
    })
    console.error('Failed to read config:', error)
  }
}

// Initialize edit values
watch(
  configUrl,
  (val) => {
    if (!isUrlEditing.value) {
      urlEditValue.value = val
    }
  },
  { immediate: true },
)

watch(
  configPath,
  (val) => {
    if (!isPathEditing.value) {
      pathEditValue.value = val
    }
  },
  { immediate: true },
)

// Watch for path changes and refresh file info
watch(configPath, () => {
  refreshFileInfo()
})

onMounted(() => {
  refreshFileInfo()
})
</script>
