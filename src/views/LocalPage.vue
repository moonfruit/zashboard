<template>
  <div
    class="relative flex h-full flex-col overflow-y-auto"
    ref="scrollContainerRef"
    @scroll.passive="handleScroll"
  >
    <!-- 左侧菜单 -->
    <LocalMenu
      ref="menuComponentRef"
      :menu-items="menuItems"
      :active-menu-key="activeMenuKey"
      @menu-click="handleMenuClick"
    />
    <!-- 右侧内容区域 -->
    <div
      class="grid grid-cols-1 gap-2 p-2"
      :style="padding"
    >
      <div class="flex flex-col gap-4">
        <div
          v-for="item in menuItems"
          :key="item.key"
          :id="`item-${item.key}`"
          :data-key="item.key"
          class="card"
        >
          <component :is="item.component" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConfigUpdateCard from '@/components/local/ConfigUpdateCard.vue'
import LocalMenu from '@/components/local/LocalMenu.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { LOCAL_MENU_KEY } from '@/constant'
import { ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import { throttle } from 'lodash'
import type { Component } from 'vue'
import { computed, ref } from 'vue'

type MenuItem = {
  key: LOCAL_MENU_KEY
  label: string
  icon: Component
  component: Component
}

const { padding } = usePaddingForViews()

const menuComponentRef = ref<InstanceType<typeof LocalMenu> | null>(null)
const scrollContainerRef = ref<HTMLDivElement>()
const menuItems = computed<MenuItem[]>(() => {
  return [
    {
      key: LOCAL_MENU_KEY.configUpdate,
      label: 'configUpdate',
      icon: ArrowDownTrayIcon,
      component: ConfigUpdateCard,
    },
  ]
})
const activeMenuKey = ref<LOCAL_MENU_KEY>(menuItems.value[0]?.key || LOCAL_MENU_KEY.configUpdate)

const getItemRef = (key: LOCAL_MENU_KEY) => {
  return document.getElementById(`item-${key}`)
}

const isTriggerByClick = ref(false)
const timeoutId = ref<number>()

const handleMenuClick = (key: LOCAL_MENU_KEY) => {
  activeMenuKey.value = key

  const index = menuItems.value.findIndex((item) => item.key === key)
  if (index !== -1) {
    isTriggerByClick.value = true
    clearTimeout(timeoutId.value)
    timeoutId.value = setTimeout(() => {
      isTriggerByClick.value = false
    }, 1000)
    const element = getItemRef(key)
    if (element && scrollContainerRef.value) {
      const containerRect = scrollContainerRef.value.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()
      const scrollTop = scrollContainerRef.value.scrollTop
      const targetScrollTop = scrollTop + elementRect.top - containerRect.top - 86

      scrollContainerRef.value.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      })
    }
  }
}

const scrollTop = ref(0)
const updateActiveMenuByScroll = () => {
  if (!scrollContainerRef.value || isTriggerByClick.value) return

  const containerRect = scrollContainerRef.value.getBoundingClientRect()
  const newScrollTop = scrollContainerRef.value.scrollTop
  const containerCenter =
    containerRect.top + containerRect.height * (newScrollTop > scrollTop.value ? 0.8 : 0.3)

  let minDistance = Infinity
  let closestKey: LOCAL_MENU_KEY | null = null

  menuItems.value.forEach((item) => {
    const element = getItemRef(item.key)
    if (!element) return

    const elementRect = element.getBoundingClientRect()
    const elementCenter = elementRect.top + elementRect.height / 2
    const distance = Math.abs(elementCenter - containerCenter)

    if (distance < minDistance) {
      minDistance = distance
      closestKey = item.key
    }
  })

  if (closestKey && closestKey !== activeMenuKey.value) {
    activeMenuKey.value = closestKey
  }

  scrollTop.value = newScrollTop
}

const handleScroll = throttle(updateActiveMenuByScroll, 100)
</script>
