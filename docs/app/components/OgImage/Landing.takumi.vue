<script lang="ts" setup>
const { title, description } = defineProps<{ title?: string, description?: string }>()
</script>

<template>
  <div
    class="w-full h-full flex flex-col items-center bg-black text-white"
    style="font-family: Geist"
  >
    <div
      class="absolute left-0 top-[178px] w-[560px] h-[8px]"
      style="transform-origin: right center; transform: rotate(9deg); background-image: linear-gradient(to right, transparent, rgba(255,255,255,0.9)); filter: blur(2px); box-shadow: 0 0 24px rgba(255,255,255,0.18)"
    />
    <div
      class="absolute left-[600px] top-[40px] w-[600px] h-[280px]"
      style="transform-origin: left center; transform: rotate(-6deg); background-image: conic-gradient(from 72deg at 0 50%, transparent 0deg, #ff5f6d 4deg, #ffb347 10deg, #f8ff6b 16deg, #6dff9a 22deg, #4fd1ff 28deg, #7b6cff 34deg, #d36bff 39deg, transparent 44deg); mask-image: linear-gradient(to right, #000, transparent 85%); filter: blur(6px); opacity: 0.5"
    />
    <div
      class="absolute left-[480px] top-[60px] w-[240px] h-[240px] rounded-full"
      style="background-image: radial-gradient(closest-side, rgba(154,230,0,0.35), transparent)"
    />

    <div class="absolute left-[530px] top-[110px] flex">
      <svg
        width="140"
        height="140"
        viewBox="0 0 64 64"
      >
        <path
          d="M30.5 10.05A22 22 0 0 0 30.5 53.95Z"
          fill="#9ae600"
        />
        <path
          d="M33.5 10.05A22 22 0 0 1 33.5 53.95Z"
          fill="#fff"
        />
      </svg>
    </div>

    <h1
      v-if="title"
      class="m-0 mt-[294px] px-[80px] text-center text-[68px] leading-[1.05]"
      style="font-family: 'Grenze Gotisch'; font-weight: 500; text-wrap: balance"
    >
      {{ title }}
    </h1>
    <p
      v-if="description"
      class="m-0 mt-[24px] px-[150px] text-center text-[28px] leading-[1.45] text-[#8f8f8f]"
      style="text-wrap: balance"
    >
      {{ description }}
    </p>

    <div
      class="absolute left-0 bottom-0 w-full h-[12px] border-t border-[#2e2e2e]"
      style="background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 8px)"
    />
  </div>
</template>
