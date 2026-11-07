import { DOCUMENT } from '@angular/common'
import { Component, computed, effect, inject, input } from '@angular/core'
import { Meta, Title } from '@angular/platform-browser'
import { Router, RouterLink } from '@angular/router'
import { diglotDocument } from '@diglot/angular'
import { locales, pageName, pages } from './locales'
import { renderPage } from './markdown'

const notices: Record<string, string> = {
  fr: 'Cette page n’est que partiellement traduite : le texte sans traduction est affiché en anglais.',
  tr: 'Bu sayfa yalnızca kısmen çevrildi: çevirisi olmayan metin İngilizce gösteriliyor.',
}

@Component({
  selector: 'app-page',
  imports: [RouterLink],
  template: `
    <header>
      <nav aria-label="Pages">
        @for (page of pages; track page) {
          <a [routerLink]="link(locale(), page)" [class.current]="page === slug()">{{ pageName(locale(), page) }}</a>
        }
      </nav>
      <nav aria-label="Languages">
        @for (option of locales; track option.code) {
          <a [routerLink]="link(option.code, slug())" [attr.hreflang]="option.code" [attr.lang]="option.code" [class.current]="option.code === locale()">{{ option.name }}</a>
        }
      </nav>
    </header>
    <main>
      @if (doc.error()) {
        <p class="error">This page could not be loaded.</p>
      }
      @else if (page(); as page) {
        @if (notice(); as notice) {
          <aside class="notice">{{ notice }}</aside>
        }
        <h1>{{ page.title }}</h1>
        <p class="description">{{ page.description }}</p>
        <article [innerHTML]="page.html" (click)="follow($event)"></article>
      }
    </main>
  `,
})
export class Page {
  readonly slug = input('index')
  readonly doc = diglotDocument(() => this.slug())
  readonly locale = this.doc.locale
  readonly page = computed(() => {
    const markdown = this.doc.markdown()
    return markdown === undefined ? undefined : renderPage(markdown, this.locale())
  })

  /** A notice for pages with segments that are shown in English. */
  readonly notice = computed(() => {
    const report = this.doc.report()
    return report && (report.missing || report.rejected.length) ? notices[this.locale()] : undefined
  })

  protected readonly pages = pages
  protected readonly locales = locales
  protected readonly pageName = pageName
  private readonly router = inject(Router)

  constructor() {
    const document = inject(DOCUMENT)
    const title = inject(Title)
    const meta = inject(Meta)
    effect(() => {
      document.documentElement.lang = this.locale()
      const page = this.page()
      if (page) {
        title.setTitle(`${page.title} · diglot × Angular`)
        meta.updateTag({ name: 'description', content: page.description })
      }
    })
  }

  protected link(locale: string, slug: string): string {
    return slug === 'index' ? `/${locale}` : `/${locale}/${slug}`
  }

  /** Follows links inside the page with the router instead of reloading the app. */
  protected follow(event: MouseEvent): void {
    const anchor = (event.target as Element).closest('a')
    const href = anchor?.getAttribute('href')
    if (href?.startsWith('/') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void this.router.navigateByUrl(href)
    }
  }
}
