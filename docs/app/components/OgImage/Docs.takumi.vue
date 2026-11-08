<script lang="ts" setup>
import type { Accent } from '../../utils/topics'

const { title, description, headline, path = '/' } = defineProps<{
  title?: string
  description?: string
  headline?: string
  /** The path of the page, which picks the topic, accent and package. */
  path?: string
}>()

const ACCENTS: Record<Accent, string> = {
  lime: '#9ae600',
  emerald: '#00d492',
  teal: '#00d5be',
  cyan: '#00d3f2',
  amber: '#ffb900',
  violet: '#a684ff',
  rose: '#ff637e',
  pink: '#fb64b6',
  blue: '#51a2ff',
  orange: '#ff8904',
  red: '#ff6467',
}

const topic = topicForPath(path)
const accent = ACCENTS[accentForPath(path)]
const pkg = topic?.packages.find(p => path === p.path || path.startsWith(`${p.path}/`))?.name
  ?? (topic?.meta.startsWith('@') ? topic.meta : 'diglot.sh')
const titleSize = (title?.length ?? 0) > 24 ? 80 : 96
</script>

<template>
  <div
    class="w-full h-full flex flex-col bg-black text-white"
    style="font-family: Geist"
  >
    <div
      class="absolute top-0 right-0 w-[900px] h-[600px]"
      :style="{ backgroundImage: `radial-gradient(60% 70% at 100% 0%, ${accent}2e, transparent 70%)` }"
    />

    <div class="flex items-center justify-between h-[104px] px-[64px]">
      <div class="flex items-center">
        <svg
          width="44"
          height="44"
          viewBox="0 0 64 64"
        >
          <path
            d="M30.5 10.05A22 22 0 0 0 30.5 53.95Z"
            :fill="accent"
          />
          <path
            d="M33.5 10.05A22 22 0 0 1 33.5 53.95Z"
            fill="#fff"
          />
        </svg>
        <span
          class="ml-[12px] text-[44px] leading-none"
          style="font-family: 'Grenze Gotisch'; font-weight: 500"
        >diglot</span>
      </div>
      <span
        class="text-[24px] text-[#b4b4b4]"
        style="font-family: 'Geist Mono'"
      >{{ pkg }}</span>
    </div>

    <div
      class="w-full h-[24px] border-t border-b border-[#2e2e2e]"
      style="background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 10px)"
    />

    <div class="flex flex-1 items-center px-[64px]">
      <div class="flex flex-col flex-1 pr-[48px]">
        <p
          v-if="headline"
          class="m-0 mb-[20px] text-[24px] uppercase tracking-[0.08em]"
          :style="{ fontFamily: 'Geist Mono', color: accent }"
        >
          {{ headline }}
        </p>
        <h1
          v-if="title"
          class="m-0 leading-[1.02] text-white"
          :style="{ fontFamily: 'Grenze Gotisch', fontWeight: 500, fontSize: `${titleSize}px`, textWrap: 'balance' }"
        >
          {{ title }}
        </h1>
        <p
          v-if="description"
          class="m-0 mt-[28px] text-[32px] leading-[1.4] text-[#8f8f8f]"
          style="line-clamp: 3; text-overflow: ellipsis; text-wrap: pretty"
        >
          {{ description }}
        </p>
      </div>

      <div
        class="flex items-center justify-center w-[232px] h-[232px] rounded-[44px] bg-[#0a0a0b]"
        :style="{
          border: `2px solid ${accent}8c`,
          boxShadow: `0 0 80px ${accent}55, inset 0 0 40px ${accent}40`,
          color: accent,
        }"
      >
        <TopicMark
          :topic="topic?.slug ?? ''"
          style="--mark-ink: #fff"
          width="128"
          height="128"
        />
      </div>
    </div>

    <div
      class="w-full h-[12px] border-t border-[#2e2e2e]"
      style="background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 8px)"
    />
  </div>
</template>
