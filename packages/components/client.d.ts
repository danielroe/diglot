declare module 'virtual:diglot' {
  /** The source locale, and a loader for the catalog of each locale of the translations repository. */
  const translations: {
    sourceLocale: string
    locales: Record<string, () => Promise<Readonly<Record<string, string>>>>
  }
  export default translations
}
