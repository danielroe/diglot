<script setup lang="ts">
interface Layer {
  slug: string
  title: string
  text: string
  to: string
  names: string[]
}

// Bottom to top. The titles and links match the topics of the documentation exactly.
const layers: Layer[] = [
  {
    slug: 'core',
    title: 'Core',
    text: 'The segment model, hashing, validation, diffs and records. It has no parser dependency and imports no Node built-ins, so it runs in browsers and edge runtimes too.',
    to: '/core/overview',
    names: ['@diglot/core'],
  },
  {
    slug: 'adapters',
    title: 'Adapters',
    text: 'A parser adapter turns a document into segments and applies translations back to it. comark and mdast produce the same hashes for the same document, and code handles the comments in code blocks.',
    to: '/adapters/overview',
    names: ['@diglot/comark', '@diglot/mdast', '@diglot/code'],
  },
  {
    slug: 'store',
    title: 'Store',
    text: 'Everything lives in files and git: configuration, sources, one record per locale and hash, manifests of each source and the bundles your site reads.',
    to: '/store/overview',
    names: ['@diglot/store'],
  },
  {
    slug: 'machine-translation',
    title: 'Machine translation',
    text: 'Drafts new segments page by page, updates existing translations with the smallest change, and checks every output against your glossary and style rules without calling a model.',
    to: '/machine-translation/overview',
    names: ['@diglot/mt'],
  },
  {
    slug: 'workflow',
    title: 'Workflow',
    text: 'The CLI extracts, diffs, validates and builds. The Action translates what changed and commits the records for people to review.',
    to: '/workflow/cli/overview',
    names: ['@diglot/cli', '@diglot/action'],
  },
  {
    slug: 'review-ui',
    title: 'Review UI',
    text: 'An experimental plugin shows a diglot store in x18n, so reviewers can edit and approve translations in a browser instead of editing JSON.',
    to: '/review-ui/overview',
    names: ['@diglot/x18n'],
  },
]

const count = layers.length
// The first layer starts to fall once the section's top has risen past this share of the viewport,
// and lands as the section pins to the top. The other layers land during the first 85% of the
// pinned scroll, so the finished cube rests on screen for a while.
const ENTRY = 0.55
const BUILD = 0.85
// How far above its place a layer starts, in layer heights.
const DROP = 8
// Each layer rides a critically damped spring: it never overshoots and its speed never jumps. Lower
// layers are stiffer than higher ones, so the stack moves as a cascade. Fast scrolling stiffens
// every spring a little, so the stack keeps up with a flick without ever snapping.
const FREQUENCY = 9
const FREQUENCY_STEP = 0.7
const SPEED_BOOST = 0.5
// While you scroll fast, the stack spreads apart a little, and closes again when you stop.
const SPREAD = 0.18
// The idle wave: the whole stack floats a little, and the gap under each layer opens and closes
// again, a little after its neighbour, so a ripple runs along the stack. It runs downwards while
// layers drop in and upwards while they lift away, so it never moves against the scroll.
const WAVE_PERIOD = 3.6
const FLOAT = 0.05
const GAP = 0.32
const WAVE_LAG = 0.8
// A small gap that stays between resting layers, so the coloured rim under each one shows.
const REST = 0.07
// Thin rounded slices that make up the body of each layer, by height in the layer (0 to 1). The top
// plate sits just below 1, so two resting layers close without their surfaces touching.
const SLICES = Array.from({ length: 16 }, (_, index) => (index / 15) * 0.97)
// The wall facing the front left at this camera angle, which carries the layer's name.
const LABEL_WALL = 90

const story = ref<HTMLElement>()
const layerElements: HTMLElement[] = []
const step = ref(count - 1)

// How many layers the scroll position asks for, from 0 to the number of layers.
let target = count
// The position and velocity of each layer's spring, in layers.
const position = Array.from({ length: count }, () => count)
const velocity = Array.from({ length: count }, () => 0)
// How fast the target moves, in layers per second, smoothed so that one jumpy frame doesn't count.
let speed = 0
// 1 while the ripple runs downwards, 0 while it runs upwards, and in between while it turns.
let downwards = 1
let frame = 0
let last = 0
let reduced = false
let observer: IntersectionObserver | undefined

function ease(t: number) {
  return 1 - (1 - t) ** 3
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function readTarget() {
  const el = story.value
  if (!el)
    return target
  const rect = el.getBoundingClientRect()
  const entry = clamp((window.innerHeight * ENTRY - rect.top) / (window.innerHeight * ENTRY))
  const pinned = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight) / BUILD)
  return entry + pinned * (count - 1)
}

/** Advances one spring by `dt` seconds, in small steps so that a long frame stays stable. */
function advance(index: number, dt: number, omega: number) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    const acceleration = omega * omega * (target - position[index]!) - 2 * omega * velocity[index]!
    velocity[index]! += acceleration * h
    position[index]! += velocity[index]! * h
  }
}

function render(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
  last = now
  const previous = target
  target = readTarget()
  // The text follows the layer that has landed most of the way.
  step.value = Math.min(count - 1, Math.max(0, Math.ceil(target - 0.4) - 1))

  if (dt > 0) {
    const instant = (target - previous) / dt
    speed += (instant - speed) * (1 - Math.exp(-dt * 8))
    if (Math.abs(target - previous) > 1e-6)
      downwards += ((target > previous ? 1 : 0) - downwards) * (1 - Math.exp(-dt * 3))
  }
  const boost = 1 + SPEED_BOOST * Math.min(1, Math.abs(speed) / 4)
  const spread = reduced ? 0 : SPREAD * Math.min(1, Math.abs(speed) / 6)

  const phase = (now / 1000) * (2 * Math.PI / WAVE_PERIOD)
  const float = reduced ? 0 : Math.sin(phase) * FLOAT
  let highest = -1
  let lift = 0
  let below = Number.NEGATIVE_INFINITY
  for (let index = 0; index < count; index++) {
    if (reduced) {
      position[index] = target
      velocity[index] = 0
    }
    else {
      advance(index, dt, (FREQUENCY - index * FREQUENCY_STEP) * boost)
    }
    const t = clamp(position[index]! - index)
    const settled = ease(t)
    if (t > 0.6)
      highest = index

    // Two ripples, one running down the stack and one running up, blended by scroll direction so
    // that turning around never makes a gap jump. Each gap is never negative, and closes completely
    // for half of each cycle.
    if (index > 0 && !reduced) {
      const down = Math.max(0, Math.sin(phase + index * WAVE_LAG)) ** 1.5
      const up = Math.max(0, Math.sin(phase - index * WAVE_LAG)) ** 1.5
      lift += settled * (GAP * (down * downwards + up * (1 - downwards)) + spread)
    }
    // A layer can never sink into the one below it, however the springs and the scroll disagree.
    const height = Math.max(index * (1 + REST) + (1 - settled) * DROP + lift + float, below + 1 + REST)
    below = height

    const el = layerElements[index]
    if (!el)
      continue
    el.style.setProperty('--y', (height - index).toFixed(4))
    el.style.setProperty('--o', Math.min(1, t * 4).toFixed(3))
  }
  for (const [index, el] of layerElements.entries())
    el.style.setProperty('--top', index === highest ? '1' : '0')
}

function loop(now: number) {
  render(now)
  frame = requestAnimationFrame(loop)
}

function start() {
  if (frame)
    return
  last = 0
  frame = requestAnimationFrame(loop)
}

function stop() {
  cancelAnimationFrame(frame)
  frame = 0
}

function onScroll() {
  // With reduced motion there is no running loop, so the stack follows each scroll directly.
  if (reduced)
    render(performance.now())
}

onMounted(() => {
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  target = readTarget()
  position.fill(target)
  render(performance.now())
  if (reduced) {
    window.addEventListener('scroll', onScroll, { passive: true })
    return
  }
  // The loop only runs while the story is on screen.
  observer = new IntersectionObserver(([entry]) => entry?.isIntersecting ? start() : stop())
  if (story.value)
    observer.observe(story.value)
})

onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <section
    ref="story"
    class="story"
    aria-label="How the packages fit together"
  >
    <div class="story-stage">
      <UContainer class="grid h-full items-center gap-8 md:grid-cols-2 max-md:grid-rows-[44%_1fr] max-md:gap-2">
        <div class="story-copy order-2 md:order-1 max-md:self-start">
          <article
            v-for="(layer, index) of layers"
            :key="layer.title"
            class="story-step"
            :style="{ '--layer-accent': `var(--color-${accentForTopic(layer.slug)}-500)` }"
            :data-active="index === step"
            :data-position="index < step ? 'before' : index > step ? 'after' : 'current'"
            :aria-hidden="index !== step"
          >
            <p class="eyebrow mb-3 flex items-center gap-2">
              <span
                class="layer-dot"
                aria-hidden="true"
              />
              Layer {{ index + 1 }} of {{ count }}
            </p>
            <h2 class="text-3xl text-highlighted sm:text-4xl lg:text-5xl">
              {{ layer.title }}
            </h2>
            <ul class="mt-4 flex flex-wrap gap-2">
              <li
                v-for="name of layer.names"
                :key="name"
                class="rounded-md border border-default bg-elevated px-2 py-0.5 font-mono text-xs text-toned"
              >
                {{ name }}
              </li>
            </ul>
            <p class="mt-4 max-w-md text-muted">
              {{ layer.text }}
            </p>
            <div class="mt-6 flex items-center gap-4">
              <UButton
                :to="layer.to"
                :aria-label="`Read the docs: ${layer.title}`"
                :tabindex="index === step ? 0 : -1"
                color="neutral"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
                class="shrink-0 whitespace-nowrap"
              >
                Read the docs
              </UButton>
              <div
                class="story-progress"
                aria-hidden="true"
              >
                <span
                  v-for="(other, dot) of layers"
                  :key="dot"
                  :style="{ '--layer-accent': `var(--color-${accentForTopic(other.slug)}-500)` }"
                  :data-on="dot <= index"
                  :data-current="dot === index"
                />
              </div>
            </div>
          </article>
        </div>

        <div
          class="cube-stage order-1 md:order-2"
          aria-hidden="true"
        >
          <div class="cube">
            <div
              v-for="(layer, index) of layers"
              :key="layer.title"
              :ref="el => layerElements[index] = el as HTMLElement"
              class="layer"
              :style="{ '--i': index, '--layer-accent': `var(--color-${accentForTopic(layer.slug)}-400)` }"
            >
              <div
                v-for="z of SLICES"
                :key="z"
                class="slice"
                :style="{ '--z': z }"
              />
              <div class="slab-top">
                <div class="slab-tile">
                  <TopicMark :topic="layer.slug" />
                </div>
              </div>
              <div
                class="side"
                :style="{ '--a': `${LABEL_WALL}deg` }"
              >
                {{ layer.title }}
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </div>
  </section>
</template>
