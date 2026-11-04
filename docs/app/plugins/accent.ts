// The documentation takes on the colour and the favicon of the topic or package in the URL.
export default defineNuxtPlugin(() => {
  const route = useRoute()
  const appConfig = useAppConfig()

  useHead({
    htmlAttrs: {
      'data-accent': computed(() => accentForPath(route.path)),
    },
  })

  // Docus renders its favicon link from this value, so updating it swaps the one icon in place.
  watch(() => route.path, (path) => {
    appConfig.header = { ...appConfig.header, logo: { ...appConfig.header?.logo, favicon: faviconForPath(path) } }
  }, { immediate: true })
})
