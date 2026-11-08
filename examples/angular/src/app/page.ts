import { DOCUMENT } from '@angular/common'
import { Component, computed, effect, inject, input } from '@angular/core'
import { Meta, Title } from '@angular/platform-browser'
import { Router, RouterLink } from '@angular/router'
import { diglotDocument } from './diglot-document'
import { DIGLOT_LOCALE, lang } from './language'
import { locales, pageName, pages } from './locales'
import { renderPage } from './markdown'

const notices: Record<string, string> = {
  fr: 'Cette page n’est que partiellement traduite : le texte sans traduction est affiché en anglais.',
  tr: 'Bu sayfa yalnızca kısmen çevrildi: çevirisi olmayan metin İngilizce gösteriliyor.',
}

@Component({
  selector: 'app-page',
  imports: [RouterLink],
  templateUrl: './page.html',
  styleUrl: './page.css',
})
export class Page {
  readonly slug = input('index')
  readonly picker = input(false)

  private readonly router = inject(Router)
  private readonly document = inject(DOCUMENT)
  private readonly title = inject(Title)
  private readonly meta = inject(Meta)
  protected readonly language = inject(DIGLOT_LOCALE)

  protected readonly doc = diglotDocument(() => this.slug())
  protected readonly locale = this.doc.locale
  protected readonly page = computed(() => {
    const markdown = this.doc.markdown()
    return markdown === undefined ? undefined : renderPage(markdown, this.base(this.locale()))
  })

  /** A notice for pages with segments that are shown in English. */
  protected readonly notice = computed(() => {
    const report = this.doc.report()
    return report && (report.missing || report.rejected.length) ? notices[this.locale()] : undefined
  })

  protected readonly lang = lang
  protected readonly pages = pages
  protected readonly locales = locales
  protected readonly pageName = pageName

  constructor() {
    effect(() => this.updateHead())
  }

  protected link(locale: string, slug: string): string {
    const base = this.base(locale)
    return slug === 'index' ? base : `${base}/${slug}`
  }

  /** Follows links inside the page with the router instead of reloading the app. */
  protected followInternalLink(event: MouseEvent): void {
    const anchor = (event.target as Element).closest('a')
    const href = anchor?.getAttribute('href')
    if (href?.startsWith('/') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void this.router.navigateByUrl(href)
    }
  }

  private base(locale: string): string {
    return this.picker() ? '/picker' : `/${locale}`
  }

  /** Sets the language, title and description of the HTML document to those of the page. */
  private updateHead(): void {
    this.document.documentElement.lang = this.locale()
    const page = this.page()
    if (page) {
      this.title.setTitle(`${page.title} · diglot × Angular`)
      this.meta.updateTag({ name: 'description', content: page.description })
    }
    else if (this.doc.error()) {
      this.title.setTitle('This page could not be loaded · diglot × Angular')
      this.meta.removeTag('name="description"')
    }
  }
}
