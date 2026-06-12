<script setup lang="ts">
defineProps<{
  title: string
  desc: string
}>()
</script>

<template>
  <div
    class="card flex items-center gap-3 px-5 py-4 rounded-xl cp
           bg-gradient-to-r from-[#667eea] to-[#764ba2]
           transition-all duration-200 hover:opacity-90 hover:-translate-y-px"
  >
    <!-- 图标 -->
    <div class="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-white/20">
      <IconFluentArrowUpload20Regular class="text-xl text-white" />
    </div>

    <!-- 文字 -->
    <div class="flex-1 min-w-0">
      <div class="text-white font-700 text-base leading-tight">{{ title }}</div>
      <div class="text-white/80 text mt-0.5 truncate">{{ desc }}</div>
    </div>

    <!-- 箭头 -->
    <IconFluentChevronRight20Regular class="text-white/70 text-xl flex-shrink-0" />
  </div>
</template>
