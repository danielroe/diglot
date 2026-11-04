<script setup lang="ts">
interface Phrase {
  text: string
  lang: string
  dir?: 'rtl'
}

const ENGLISH: Phrase = { text: 'Translate docs one segment at a time.', lang: 'en' }

const others: Phrase[] = [
  { text: 'Traduisez la documentation, un segment à la fois.', lang: 'fr' },
  { text: 'Übersetze Dokumentation Segment für Segment.', lang: 'de' },
  { text: 'Traduce la documentación, un segmento a la vez.', lang: 'es' },
  { text: 'ドキュメントを、セグメントごとに翻訳。', lang: 'ja' },
  { text: 'Traduza a documentação, um segmento de cada vez.', lang: 'pt' },
  { text: '逐段翻译文档。', lang: 'zh' },
  { text: 'Traduci la documentazione, un segmento alla volta.', lang: 'it' },
  { text: '문서를 세그먼트 단위로 번역하세요.', lang: 'ko' },
  { text: 'ترجم الوثائق، مقطعًا تلو الآخر.', lang: 'ar', dir: 'rtl' },
  { text: 'Vertaal documentatie, segment voor segment.', lang: 'nl' },
  { text: 'Переводите документацию по одному сегменту.', lang: 'ru' },
  { text: 'תרגמו תיעוד, קטע אחר קטע.', lang: 'he', dir: 'rtl' },
  { text: 'Tłumacz dokumentację segment po segmencie.', lang: 'pl' },
  { text: 'Belgeleri segment segment çevirin.', lang: 'tr' },
  { text: 'Översätt dokumentation, ett segment i taget.', lang: 'sv' },
  { text: 'Перекладайте документацію по одному сегменту.', lang: 'uk' },
  { text: 'दस्तावेज़ों का अनुवाद करें, एक बार में एक खंड।', lang: 'hi' },
  { text: 'Dịch tài liệu, từng đoạn một.', lang: 'vi' },
  { text: 'Terjemahkan dokumentasi, satu segmen setiap kali.', lang: 'id' },
  { text: 'Μεταφράστε την τεκμηρίωση, ένα τμήμα τη φορά.', lang: 'el' },
  { text: 'Překládejte dokumentaci po jednotlivých segmentech.', lang: 'cs' },
  { text: 'แปลเอกสารทีละส่วน', lang: 'th' },
  { text: 'Oversæt dokumentation, ét segment ad gangen.', lang: 'da' },
  { text: 'Oversett dokumentasjon, ett segment om gangen.', lang: 'nb' },
  { text: 'Käännä dokumentaatio segmentti kerrallaan.', lang: 'fi' },
  { text: 'Tradu documentația, câte un segment pe rând.', lang: 'ro' },
  { text: 'Fordítsd le a dokumentációt szegmensenként.', lang: 'hu' },
  { text: 'Prevodite dokumentaciju segment po segment.', lang: 'hr' },
  { text: 'Prekladajte dokumentáciu po jednotlivých segmentoch.', lang: 'sk' },
  { text: 'Prevajajte dokumentacijo segment za segmentom.', lang: 'sl' },
  { text: 'Tradueix la documentació, un segment cada vegada.', lang: 'ca' },
  { text: 'Traduce a documentación, un segmento de cada vez.', lang: 'gl' },
  { text: 'Tõlgi dokumentatsiooni lõikhaaval.', lang: 'et' },
  { text: 'Tulko dokumentāciju pa vienam segmentam.', lang: 'lv' },
  { text: 'Verskite dokumentaciją po vieną segmentą.', lang: 'lt' },
  { text: 'Þýddu skjölun, einn hluta í einu.', lang: 'is' },
  { text: 'Aistrigh doiciméadú, mír amháin ag an am.', lang: 'ga' },
  { text: 'Cyfieithwch ddogfennaeth, un segment ar y tro.', lang: 'cy' },
]

const phrase = ref<Phrase>(ENGLISH)
const leaving = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

// English, then two random languages, English, three, English, four, and so on.
let run = 2
let left = run
let bag: Phrase[] = []

function shuffle(list: Phrase[]) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

function nextPhrase(): Phrase {
  if (left === 0) {
    run++
    left = run
    return ENGLISH
  }
  left--
  if (!bag.length)
    bag = shuffle(others)
  return bag.pop()!
}

function cycle() {
  leaving.value = true
  setTimeout(() => {
    phrase.value = nextPhrase()
    leaving.value = false
  }, 450)
}

const hero = ref<HTMLElement>()
let frame = 0

// Brightens the dark hero's glow as you scroll away from the top.
function updateGlow() {
  frame = 0
  const g = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.3)))
  hero.value?.style.setProperty('--g', g.toFixed(3))
}

function onScroll() {
  if (!frame)
    frame = requestAnimationFrame(updateGlow)
}

const command = 'pnpm dlx @diglot/cli status'
const copied = ref(false)

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(command)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {
    copied.value = false
  }
}

const principles = [
  {
    icon: 'i-lucide-split',
    title: 'Segments, not files',
    description: 'Every heading, paragraph, list item, table cell and prose comment has its own identity, so a one-line edit touches one translation.',
    to: '/guide/concepts/segments',
  },
  {
    icon: 'i-lucide-git-branch',
    title: 'Translations live in git',
    description: 'One small JSON record per locale and hash. Reviews, edits and rollbacks are ordinary commits and pull requests.',
    to: '/guide/concepts/translation-records',
  },
  {
    icon: 'i-lucide-copy-check',
    title: 'Translated once',
    description: 'Identical text shares one hash, so it is translated once across files, sources and branches.',
    to: '/guide/concepts/skeletons-and-hashes',
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Links and code stay safe',
    description: 'URLs, inline code, components and HTML are placeholders. Changing them never triggers a new translation, and a translation cannot alter them.',
    to: '/guide/concepts/skeletons-and-hashes',
  },
]

// The headline and the logo move on their own, so visitors can pause them (WCAG 2.2.2).
const paused = ref(false)

function setPaused(value: boolean) {
  paused.value = value
  clearInterval(timer)
  if (!value)
    timer = setInterval(cycle, 3200)
}

onMounted(() => {
  updateGlow()
  window.addEventListener('scroll', onScroll, { passive: true })
  setPaused(matchMedia('(prefers-reduced-motion: reduce)').matches)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('scroll', onScroll)
  if (frame)
    cancelAnimationFrame(frame)
})
</script>

<template>
  <div>
    <section
      ref="hero"
      class="relative isolate -mt-(--ui-header-height) overflow-hidden pt-(--ui-header-height)"
      :data-paused="paused"
    >
      <div
        class="hero-light absolute inset-0 -z-10"
        aria-hidden="true"
      >
        <div class="hero-gradient absolute inset-0" />
        <div class="noise absolute inset-0" />
        <LandingPixelField />
      </div>
      <UContainer class="flex min-h-[calc(100vh-var(--ui-header-height))] flex-col items-center justify-center py-20 text-center">
        <div class="relative mb-8">
          <div
            class="hero-dark -z-10"
            aria-hidden="true"
          >
            <div class="hero-beam" />
            <div class="hero-spectrum" />
            <div class="noise" />
          </div>
          <DiglotMark class="hero-mark mark-animate relative size-28 sm:size-44" />
        </div>
        <h1 class="max-w-4xl text-balance text-5xl text-highlighted sm:text-7xl">
          <span class="sr-only">Translate docs one segment at a time.</span>
          <span
            class="hero-title block min-h-[2.2em]"
            :data-out="leaving"
            :lang="phrase.lang"
            :dir="phrase.dir"
            aria-hidden="true"
          >{{ phrase.text }}</span>
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted">
          diglot splits markdown into hashed segments and keeps every translation in git. Machines write the first draft, and the people who review it have the last word.
        </p>
        <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
          <UButton
            to="/guide/start/introduction"
            size="xl"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
          >
            Get started
          </UButton>
          <UButton
            size="xl"
            color="neutral"
            variant="outline"
            class="font-mono"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="`Copy ${command}`"
            @click="copyCommand"
          >
            {{ command }}
          </UButton>
          <span
            class="sr-only"
            aria-live="polite"
          >{{ copied ? 'Copied to the clipboard' : '' }}</span>
        </div>
      </UContainer>
      <UButton
        class="absolute bottom-6 right-6"
        color="neutral"
        variant="ghost"
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        :aria-label="paused ? 'Play the hero animation' : 'Pause the hero animation'"
        @click="setPaused(!paused)"
      />
    </section>

    <div
      class="hatch"
      aria-hidden="true"
    />

    <section class="py-16">
      <UContainer>
        <div class="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div class="landing-card min-w-0 p-5 [overflow-wrap:anywhere]">
            <p class="eyebrow mb-3">
              docs/intro.md
            </p>
            <p class="font-mono text-sm leading-relaxed text-toned">
              Nuxt is powered by <span class="text-primary">[Nitro](https://nitro.build)</span>, and <span class="text-primary">`useFetch`</span> is built in.
            </p>
          </div>
          <UIcon
            name="i-lucide-arrow-right"
            class="mx-auto size-5 rotate-90 text-dimmed lg:rotate-0"
            aria-hidden="true"
          />
          <div class="landing-card min-w-0 p-5 [overflow-wrap:anywhere]">
            <p class="eyebrow mb-3">
              skeleton · 87ecf1244d975205
            </p>
            <p class="font-mono text-sm leading-relaxed text-toned">
              Nuxt is powered by <span class="text-primary">{0}</span>Nitro<span class="text-primary">{/0}</span>, and <span class="text-primary">{1}</span> is built in.
            </p>
          </div>
          <UIcon
            name="i-lucide-arrow-right"
            class="mx-auto size-5 rotate-90 text-dimmed lg:rotate-0"
            aria-hidden="true"
          />
          <div class="landing-card min-w-0 p-5 [overflow-wrap:anywhere]">
            <p class="eyebrow mb-3">
              fr/segments/87/87ecf1244d975205.json
            </p>
            <p class="font-mono text-sm leading-relaxed text-toned">
              Nuxt est propulsé par <span class="text-primary">{0}</span>Nitro<span class="text-primary">{/0}</span>, et <span class="text-primary">{1}</span> est intégré.
            </p>
          </div>
        </div>
        <p class="mt-4 text-center text-sm text-dimmed">
          The translator only ever sees the middle form. The link and the code come back from the source.
        </p>
      </UContainer>
    </section>

    <div
      class="hatch"
      aria-hidden="true"
    />

    <LandingStory />

    <div
      class="hatch"
      aria-hidden="true"
    />

    <section class="py-20">
      <UContainer>
        <p class="eyebrow mb-3">
          Why diglot
        </p>
        <h2 class="max-w-2xl text-balance text-4xl text-highlighted sm:text-5xl">
          Keeping translated docs in sync is the hard part.
        </h2>
        <div class="mt-10 grid gap-3 sm:grid-cols-2">
          <NuxtLink
            v-for="item of principles"
            :key="item.title"
            :to="item.to"
            class="landing-card block p-6"
          >
            <UIcon
              :name="item.icon"
              class="mb-4 size-5 text-primary"
            />
            <h3 class="text-2xl text-highlighted">
              {{ item.title }}
            </h3>
            <p class="mt-2 text-sm text-muted">
              {{ item.description }}
            </p>
          </NuxtLink>
        </div>
      </UContainer>
    </section>

    <div
      class="hatch"
      aria-hidden="true"
    />

    <section class="py-20">
      <UContainer>
        <div class="mx-auto max-w-3xl">
          <p class="eyebrow mb-3">
            Quick start
          </p>
          <h2 class="text-balance text-4xl text-highlighted sm:text-5xl">
            A config file, a list of sources and four commands.
          </h2>
          <div class="mt-8">
            <slot />
          </div>
          <div class="mt-8">
            <UButton
              to="/guide/start/quick-start"
              color="neutral"
              variant="outline"
              trailing-icon="i-lucide-arrow-right"
            >
              Read the quick start
            </UButton>
          </div>
        </div>
      </UContainer>
    </section>
  </div>
</template>
