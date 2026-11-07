# @diglot/angular

[Angular](https://angular.dev) providers for [diglot](../../README.md) translations. You tell `provideDiglot()` where the bundles of your translations repository and your source Markdown documents are, and `diglotDocument()` gives your components a document in the current locale, in the browser and during server rendering or prerendering. Your app renders the Markdown with whatever renderer it already uses.

```bash
pnpm add @diglot/angular
```

Add the providers to your application config:

```ts
import { provideHttpClient, withFetch } from '@angular/common/http'
import { provideDiglot, withDiglotRouteLocale } from '@diglot/angular'
import policy from '../../translations/.diglot/policy.json'

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideDiglot({
      defaultLocale: 'en',
      bundleUrl: locale => `/translations/${locale}.json`,
      sourceUrl: path => `/docs/${path}.md`,
      policy: policy as PolicySnapshot,
      parser: 'mdast',
    }, withDiglotRouteLocale('locale')),
  ],
}
```

Then read a document in a component:

```ts
@Component({
  selector: 'app-page',
  template: `<article [innerHTML]="html()"></article>`,
})
export class Page {
  readonly slug = input.required<string>()
  readonly doc = diglotDocument(() => this.slug())
  readonly html = computed(() => marked.parse(this.doc.markdown() ?? '', { async: false }))
}
```

`diglotDocument()` returns signals for the `markdown` to render, the `report` of what was applied, the `locale`, `isLoading` and `error`. Each locale's bundle is fetched once and shared by every document, the default locale is shown without a bundle, and documents rendered on the server reach the browser through `TransferState`, so hydration fetches nothing. Set `parser` to `comark` or `mdast` in the translations repository, and build its bundles with `diglot build` before you build your app.

The package needs Angular 22. It translates documents, not the strings of your templates, so it works next to `@angular/localize`.

See the [Angular integration docs](https://diglot.sh/integrations/angular) for every option, and [`examples/angular`](../../examples/angular) for an app in English, French and Turkish.
