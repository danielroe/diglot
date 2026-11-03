interface HastNode {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * Gives every code block a tab stop, so a block that scrolls sideways can be scrolled with the
 * keyboard (WCAG 2.1.1). It runs at build time, so the attribute is in the rendered HTML.
 */
export function rehypeFocusableCode() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName === 'pre')
        node.properties = { ...node.properties, tabIndex: 0 }
      for (const child of node.children ?? [])
        visit(child)
    }
    visit(tree)
  }
}
