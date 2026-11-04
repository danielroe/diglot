---
seo:
  title: Segment-level translation for markdown documentation
  description: diglot splits markdown into hashed segments, stores every translation in git, and lets machines draft while reviewers decide.
---

::landing-page

```yaml [sources.yml]
sources:
  - name: nuxt-main
    repo: nuxt/nuxt
    ref: main
    path: ../nuxt
    dir: docs
```

```bash
pnpm dlx @diglot/cli extract   # write .diglot/manifest/<source>.json
pnpm dlx @diglot/cli status    # coverage per locale and source
pnpm dlx @diglot/cli validate  # check every record
pnpm dlx @diglot/cli build     # write dist/<locale>.json
```

::
