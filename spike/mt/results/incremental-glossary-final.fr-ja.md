## Incremental re-translation

| case | locale | commit | kind | method | src sentences (unchanged) | aligned | update kept | update run 2 kept | fresh kept | update == human | runs agree | token values ok | tone kept (update / fresh) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| case1 | fr | 9a348c8be4 | clause added | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / no |
| case2 | fr | 9f91560d80 | code only | carry | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / no |
| case3 | fr | 7802b2c216 | sentence added | model | 2 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / no |
| case4 | fr | 9ceeba8c6d | sentence rewritten | model | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / no |
| case5 | fr | 3e5d8b3c50 | code only | carry | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / no |
| case6 | fr | 68b8a4e12b | sentence rewritten | model | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / yes |
| case7 | fr | 6f2fc18e3a | sentence rewritten | model | 3 (2) | yes | 2/2 | 2/2 | 1/2 | no | no | yes | yes / no |
| case8 | fr | e0259454fa | phrase changed | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / yes |
| case9 | fr | d62847af00 | typo (article) | model | 3 (2) | yes | 2/2 | 2/2 | 0/2 | yes | yes | yes | yes / no |
| case10 | fr | d62847af00 | typo (pronoun) | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | yes | yes | yes | yes / no |
| case11 | fr | b437b50f50 | markup only (_ to *) | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / no |
| case12 | fr | 84c1145a64 | sentence added | model | 4 (4) | yes | 4/4 | 4/4 | 0/4 | no | yes | yes | yes / no |
| case13 | fr | 4694ae0465 | sentence removed | model | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / yes |
| case14 | fr | 844cbf9081 | code only | carry | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | yes | yes | yes / no |
| case15 | fr | 092fe3f14e | sentence added | model | 3 (3) | yes | 3/3 | 3/3 | 0/3 | no | yes | yes | yes / no |
| case1 | ja | 9a348c8be4 | clause added | model | 2 (1) | no | 2/3 | 2/3 | 0/3 | no | no | yes | yes / no |
| case2 | ja | 9f91560d80 | code only | carry | 3 (2) | no | 4/5 | 4/5 | 0/5 | no | yes | yes | yes / no |
| case3 | ja | 7802b2c216 | sentence added | model | 2 (2) | no | 3/3 | 3/3 | 0/3 | no | no | yes | yes / no |
| case4 | ja | 9ceeba8c6d | sentence rewritten | model | 3 (2) | no | 3/5 | 3/5 | 0/5 | no | yes | yes | yes / no |
| case5 | ja | 3e5d8b3c50 | code only | carry | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / no |
| case6 | ja | 68b8a4e12b | sentence rewritten | model | 3 (2) | yes | 2/2 | 2/2 | 0/2 | no | no | yes | yes / no |
| case7 | ja | 6f2fc18e3a | sentence rewritten | model | 3 (2) | no | 3/4 | 3/4 | 0/4 | no | no | yes | yes / no |
| case8 | ja | e0259454fa | phrase changed | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | no | yes | yes | yes / no |
| case9 | ja | d62847af00 | typo (article) | model | 3 (2) | no | 4/4 | 4/4 | 0/4 | yes | yes | yes | yes / no |
| case10 | ja | d62847af00 | typo (pronoun) | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | yes | yes | yes | yes / no |
| case11 | ja | b437b50f50 | markup only (_ to *) | model | 2 (1) | yes | 1/1 | 1/1 | 0/1 | yes | yes | yes | yes / no |
| case12 | ja | 84c1145a64 | sentence added | model | 4 (4) | no | 5/5 | 5/5 | 0/5 | no | yes | yes | yes / no |
| case13 | ja | 4694ae0465 | sentence removed | model | 3 (2) | no | 3/4 | 3/4 | 0/4 | no | yes | yes | yes / no |
| case14 | ja | 844cbf9081 | code only | carry | 3 (2) | no | 3/4 | 3/4 | 0/4 | no | yes | yes | yes / no |
| case15 | ja | 092fe3f14e | sentence added | model | 3 (3) | yes | 3/3 | 3/3 | 0/3 | no | yes | yes | yes / no |

| locale | update kept (all) | update kept (aligned only) | update run 2 kept | fresh kept | cases fully preserved | token values ok | tone kept update / fresh | runs agree |
|---|---|---|---|---|---|---|---|---|
| fr | 28/28 | 28/28 | 28/28 | 1/28 | 15/15 | 15/15 | 15/15 / 3/15 | 14/15 |
| ja | 39/46 | 9/9 | 39/46 | 0/46 | 9/15 | 15/15 | 15/15 / 0/15 | 11/15 |

### Sentences not found verbatim in the update

```
[ja case1 unaligned] この型が、ルートに対する[`$fetch`と`useFetch`](/docs/getting-started/data-fetching)の呼び出しの型になる。
[ja case2 unaligned] ** Nuxt 5 は Node `22.19`、`24.11` 以降を必要とする。
[ja case4 unaligned] 独自のイベントオブジェクトがWeb準拠の形をしていない場合は、そのWeb準拠のビュー(`toNuxtRequestEvent()`が返す)をハンドラーに渡し、独自のイベントは`~app`プロパティに持たせる。
[ja case4 unaligned] こうすれば、`useRequestEvent()`やレンダーフックからアプリケーションコードに独自のイベントが渡される。
[ja case7 unaligned] モジュールやサーバー機能は、この値から独自のシークレットを導出して利用できる。
[ja case13 unaligned] ボット検出用の正規表現は次のようにカスタマイズできる。
[ja case14 unaligned] サーバーハンドラーを追加するには `addServerHandler`、開発モードでのみ使用するサーバーハンドラーを追加するには `addDevServerHandler`、Nitro のランタイムの挙動を拡張するプラグインを追加するには `addServerPlugin`、Nitro にプリレンダリングさせるルートを追加するには `addPrerenderRoutes` を使う。
```
