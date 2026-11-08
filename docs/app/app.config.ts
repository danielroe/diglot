export default defineAppConfig({
  docus: {
    colorMode: '',
  },
  seo: {
    title: 'diglot',
    description: 'Segment-level, human-first translation for markdown documentation.',
  },
  header: {
    title: 'diglot',
  },
  github: {
    url: 'https://github.com/danielroe/diglot',
    branch: 'main',
    rootDir: 'docs',
  },
  navigation: {
    sub: 'aside',
  },
  toc: {
    bottom: {
      links: [
        {
          icon: 'i-simple-icons-github',
          label: 'GitHub repository',
          to: 'https://github.com/danielroe/diglot',
          target: '_blank',
        },
        {
          icon: 'i-custom-npmx',
          label: '@diglot on npmx',
          to: 'https://npmx.dev/org/diglot',
          target: '_blank',
        },
      ],
    },
  },
  ui: {
    colors: {
      primary: 'lime',
      secondary: 'violet',
      neutral: 'neutral',
    },
    header: {
      slots: {
        root: 'bg-default/70 backdrop-blur-lg border-default',
      },
    },
    pageLinks: {
      slots: {
        linkLabel: 'truncate pe-4',
        linkLabelExternalIcon: 'size-3 absolute top-0 end-0 text-dimmed',
      },
    },
    contentSearchButton: {
      slots: {
        base: 'bg-elevated/60 hover:bg-elevated ring ring-inset ring-default',
      },
    },
    pageHeader: {
      slots: {
        root: 'border-b border-dashed border-default py-10',
        headline: 'mb-4 font-mono text-xs font-normal uppercase tracking-[0.08em] text-primary',
        title: 'font-display text-4xl font-medium sm:text-5xl',
        description: 'mt-5 text-lg',
      },
    },
    contentSurround: {
      slots: {
        link: 'rounded-xl border-default bg-elevated/40 hover:border-primary hover:bg-elevated',
        linkLeading: 'bg-transparent ring-default group-hover:bg-transparent',
        linkTitle: 'font-display text-xl font-medium',
      },
    },
    prose: {
      h2: {
        slots: {
          base: 'mt-16 border-t border-dashed border-default pt-10 font-medium',
          leading: 'top-11',
        },
      },
      h3: {
        slots: { base: 'font-medium' },
      },
      a: {
        base: 'border-b-0 font-medium text-highlighted underline decoration-primary/50 decoration-1 underline-offset-4 hover:border-transparent hover:decoration-primary',
      },
      code: {
        variants: {
          color: {
            neutral: 'border-default bg-elevated font-normal text-highlighted',
          },
        },
      },
      pre: {
        slots: {
          root: 'my-6',
          header: 'rounded-t-lg border-default bg-muted py-2.5',
          filename: 'font-mono text-xs uppercase tracking-[0.08em] text-muted',
          base: 'whitespace-pre rounded-lg border-default',
        },
      },
      table: {
        slots: {
          root: 'my-6 rounded-lg',
          base: 'rounded-lg',
        },
      },
      th: {
        base: 'border-default font-mono text-xs font-medium uppercase tracking-[0.08em] text-muted',
      },
      td: {
        base: 'border-default [&_code]:whitespace-nowrap',
      },
      callout: {
        slots: {
          base: 'rounded-lg border-s-[3px] px-5 py-4',
        },
        // One shade darker in light mode than Nuxt UI's default, for WCAG AA contrast.
        variants: {
          color: {
            info: { base: 'text-info-800 dark:text-info-200' },
            success: { base: 'text-success-800 dark:text-success-200' },
            warning: { base: 'text-warning-800 dark:text-warning-200' },
            error: { base: 'text-error-800 dark:text-error-200' },
          },
        },
      },
      blockquote: {
        base: 'border-s-2 border-primary not-italic text-muted',
      },
      ul: {
        base: 'marker:text-primary/60',
      },
      ol: {
        base: 'marker:font-mono marker:text-sm marker:text-primary',
      },
      hr: {
        base: 'border-dashed',
      },
    },
  },
})
