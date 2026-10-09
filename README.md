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

グローバル関連付けでは、グローバルMANGOの「新着」ページから最大100件を取得します。日本サイトの商品ページですでに関連付け済みのSEE LOOK商品は候補から除外します。

サイト側のHTML変更やアクセス制限で取得できない場合は、コンソールに対象URLとエラーを出し、取得できた商品のみで結果を更新します。利用規約・robots.txt・アクセス頻度を確認したうえで運用してください。

## GitHub Pagesで公開する

GitHubリポジトリにこのフォルダーをPushし、リポジトリの `Settings > Pages > Source` で `GitHub Actions` を選択してください。`pages.yml` が `public` を静的サイトとして公開します。

公開URLは次の形式です。

`https://<ユーザー名>.github.io/<リポジトリ名>/`

例えば、リポジトリが `amikitamura285/MANGO_association` の場合は、

`https://amikitamura285.github.io/MANGO_association/`

のようにアクセスできます。

個別ページのURLも利用できます。

- 関連付け: `https://amikitamura285.github.io/MANGO_association/relation/`
- グローバル関連付け: `https://amikitamura285.github.io/MANGO_association/global/`

このサイトは、閲覧者が Node.js をインストールせず、ブラウザだけで見ることができます。`public` 配下の HTML / CSS / JavaScript / JSON をそのまま表示する静的サイトなので、誰でも追加ダウンロードなしで利用できます。

`crawl.yml` は毎日19:00 UTC（日本時間4:00）にGitHub Actions上でクロールし、`public/products.json` と `public/global-products.json` を更新してコミットします。Actionsの初回実行は `Actions > Crawl MANGO products > Run workflow` から手動実行できます。

## グローバル関連付けの更新(ブラウザから)

`shop.mango.com` はGitHub Actionsなどの自動アクセスをVercelのSecurity Checkpointで制限しているため、グローバルの商品一覧はブラウザから収集します。サイトのURLを知っている人なら誰でも、`/global/` ページの「UPDATE」から更新できます。

### 使い方(更新する人)

1. 初回のみ: パネルの「MANGO収集」リンクをブックマークバーへドラッグします。
2. 「MANGOを開く」で開いたタブで、ブックマーク「MANGO収集」をクリックします。
3. 収集 → 日本商品との照合 → 画面表示 → 公開サイトへの保存まで自動で行われます。公開サイトへの反映は数分かかります。

### 仕組み

```
ブラウザ(収集) → 中継サーバー(検証して保存) → data/global-raw.json
  → GitHub Actions(build-global.js が日本商品と照合) → public/global-products.json
```

- 中継サーバー(`apps-script/Code.gs`)だけがGitHubの書き込みトークンを持ちます。ページにトークンは含まれません。受け取ったデータは項目ごとに検証し(URLは `shop.mango.com`、画像は `*.mango.com` のみなど)、10分以内の再送信や、前回の半分未満の商品数は受け付けません。
- 毎朝4:00のActionsも、保存済みの `data/global-raw.json` を最新の日本商品で照合し直します。日本側に新しく出た商品のリンクは、収集しなくても毎日反映されます。
- 誤ったデータが入った場合は、`data/global-raw.json` のコミットを元に戻してください。

### 中継サーバー(Google Apps Script)のセットアップ(最初の1回、インストール不要)

1. GitHubで Fine-grained token を作成します(Repository access は `MANGO_association` のみ、Permissions は Contents: Read and write と Actions: Read and write。後者は関連付けチェックの UPDATE ボタン用)。トークンは他人に見せず、手順3以外には貼らないでください。
2. https://script.google.com で「新しいプロジェクト」を作り、`apps-script/Code.gs` の内容を貼り付けて保存します。
3. 左メニューの「プロジェクトの設定」→「スクリプト プロパティ」に、`GITHUB_TOKEN` という名前でトークンを登録します。
4. 右上の「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」で、次のように設定してデプロイします。初回はGoogleの権限承認が求められます。
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
5. 表示された「ウェブアプリのURL」(`https://script.google.com/macros/s/〜/exec`)を `public/global-update.js` の `RELAY_URL` に設定してPushします。

コードを変更したときは、「デプロイを管理」から新しいバージョンでデプロイし直してください(URLは変わりません)。

グローバル関連付けの「確認済」は、この中継サーバーのスクリプト プロパティ(`CHECKED_CODES`)に保存され、ページを開いた全員で共有されます。一度確認済にした商品は、UPDATE でページの内容が入れ替わっても確認済のまま残ります(新しい順に最大600件)。

`RELAY_URL` が未設定の間は、更新結果はその画面にだけ表示されます。ページに送れなかった場合は `global-raw.json` がダウンロードされるので、`public/tools/update-global.html` と `update-global.ps1` で手動反映もできます。
