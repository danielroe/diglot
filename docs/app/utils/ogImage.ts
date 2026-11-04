// Prerendered OG images hash their options into the URL, so the text needs no length limit.

/** The title shown on an OG image. */
export function formatOgTitle(title: string | undefined): string | undefined {
  return title
}

/** The description shown on an OG image. */
export function formatOgDescription(_title: string | undefined, description: string | undefined): string | undefined {
  return description
}
