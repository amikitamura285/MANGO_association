# MANGO FINDER

MANGO公式オンラインストアの商品を毎日取得し、次の条件を満たす商品を表示する小さなWebアプリです。

- 商品名に含まれる英字部分とブランド商品番号の最初の数字が同じ商品が2件以上ある
- その商品の関連アイテム欄に、同じ英字名の商品がない
- ブランドがMANGO（MANGO MAN／MANGO KIDSは除外）
- 同じ英字名の商品は、ブランド商品番号の最初の数字が同じものだけを横並び表示
- メイン商品は「確認済」にチェックを入れると、「今日のアイテム」から外れ、一覧最下部の「確認済」に移動

## 起動

```bash
npm start
```

`http://localhost:3000` を開きます。画面の「今すぐクロール」から手動実行もできます。

## 自動クロール

サーバーが起動している間、日本時間（JST）の毎朝4:00に実行します。実行マシンのタイムゾーンには依存しません。初回データの取得は `npm run crawl` でも実行できます。

- 対象: `https://japan.mango.com/sitemap_commodity.xml`
- 既定の取得上限: サイトマップ掲載の商品を全件（`CRAWL_LIMIT` を指定すると上限設定可能）
- 既定の同時取得数: 12（`CRAWL_CONCURRENCY` で変更可能）
- 保存先: `data/products.json`

サイト側のHTML変更やアクセス制限で取得できない場合は、コンソールに対象URLとエラーを出し、取得できた商品のみで結果を更新します。利用規約・robots.txt・アクセス頻度を確認したうえで運用してください。

## GitHub Pagesで公開する

GitHubリポジトリにこのフォルダーをPushし、リポジトリの `Settings > Pages > Source` で `GitHub Actions` を選択してください。`pages.yml` が `public` を静的サイトとして公開します。

`crawl.yml` は毎日19:00 UTC（日本時間4:00）にGitHub Actions上でクロールし、`public/products.json` を更新してコミットします。PagesのURL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）を共有すれば、閲覧者は何もダウンロードせずブラウザだけで利用できます。Actionsの初回実行は `Actions > Crawl MANGO products > Run workflow` から手動実行できます。
