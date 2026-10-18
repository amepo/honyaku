# honyaku — 韓国語 文字起こし

ブラウザだけで動く **韓国語のリアルタイム文字起こし＋日本語訳** アプリ。
マイクの声や、PC で流している配信（YouTube / Twitch / SOOP など）、Discord のボイスチャット音声をハングルに書き起こして日本語訳を付けます。

- インストール不要・無料・API キー不要（ブラウザ標準の Web Speech API、`ko-KR`）
- iPhone（Safari）/ Android・PC（Chrome, Edge）対応。PWA としてホーム画面に追加可
- 話し途中の文字もグレーでリアルタイム表示 → 確定したら行として追加
- 無音でブラウザが止めても自動で再開（長時間の聞き取り向け）
- **日本語訳をアプリ内で表示**（ヘッダーの「訳」でオン/オフ）。確定した行から自動翻訳（最大2件を並行処理し、会話中の待ちを抑制）
- **話すタブ**: 日本語で言いたいことを入力すると、韓国語訳とカタカナ読みを表示。韓国語や読みをコピーできます
- **翻訳方法を選択**: 自動（端末内を優先）、端末内のみ、Google、Papago。対応ブラウザなら日本語→韓国語も翻訳
- **配信・Discord 音声モード**（PC の Chrome / Edge）: Discord のタブ音声、対応環境では選択したアプリウィンドウの音声を入力にできる
- **読み（発音）を表示**（ヘッダーの「読み」でカナ → ローマ字 → なし を切替）。
  綴りではなく実際の発音に寄せる（연음・비음화・유음화・격음화・경음화・구개음화 を適用。例: 감사합니다 → カムサハムニダ / gamsahamnida）。
  端末内で計算するのでオフラインでも動く。例外的な発音の単語はズレることがある
- 行ごとに コピー / 訳し直し / 削除
- 全文コピー・`.txt` 保存（時刻付きにも切替可）・文字サイズ変更
- 記録は端末内（localStorage）に自動保存。録音中は画面スリープを防止（対応ブラウザのみ）

## 使い方

```bash
npm start   # → http://localhost:5174/
npm test    # ロジックのユニットテスト（Node 22、依存なし）
```

マイクは **https か localhost** でしか使えません。スマホで試すなら GitHub Pages で公開するのが楽です。

## Discord のボイスチャットを翻訳する（PC）

1. 最新の **Chrome か Edge** で開く（`SpeechRecognition.start(音声トラック)` に対応した版が必要。Chrome 141 で動作確認）
2. 下の切替で **🖥️ 配信・Discord 音声** を選んで、青いボタンを押す
3. Discord をブラウザで使う場合は Discord タブを選び、**「タブの音声も共有する」**をオン
4. Discord アプリの場合は共有ダイアログの **ウィンドウ** から Discord を選び、音声共有の項目があればオンにする。Mac では Chrome の画面収録・システムオーディオ権限が必要な場合があります
5. ヘッダーの「訳」をオンにすると、日本語訳が表示されます。止めるときはボタンをもう一度押します

- 配信の音はそのまま聞こえる（アプリはミュートしない）。映像は使わず、すぐ捨てています
- Chrome 141 以降はウィンドウ音声共有の指定に対応します。音声の選択肢はブラウザや OS によって異なります
- Mac で Discord アプリの音声が選べない場合は、Discord を Chrome のタブで開いてタブ音声を共有する方法が簡単です
- 共有元に通知音や他のアプリの音が含まれると、その音も認識対象になります
- 共有元に音声が含まれていない場合は「音声を共有できなかった」と表示されます。Mac では Chrome のプライバシー設定を確認するか、仮想オーディオデバイス（例: BlackHole）をマイクとして設定してください

## 翻訳について

「聞く / 話す」タブの下にある「翻訳方法」から選べます。**自動**はブラウザ内蔵 Translator API が選んだ言語ペアで利用可能なら端末内で翻訳し、そうでなければ Google 翻訳に切り替えます。**端末内**は利用可能な場合だけ動きます。**Google**は Google 翻訳を使います。

Google 翻訳は無料の非公式エンドポイント（`translate.googleapis.com`）を使うため、仕様変更や回数制限で失敗することがあります。翻訳に失敗した行は「訳」で再試行できます。

### Papago を使う

Papago は Naver Cloud のアカウントと Papago Translation API の利用設定が必要です。API キーを公開ページに置かないよう、Cloudflare Worker を中継として使います。Worker と Naver Cloud の利用料金・無料枠は各サービスの契約に従います。

1. Naver Cloud Platform で Papago Translation API を有効にして、Client ID と Client Secret を用意します。
2. [Cloudflare Workers](https://workers.cloudflare.com/) にログインできる状態で、このリポジトリの `worker` ディレクトリへ移動します。
3. Mac のターミナルで、Worker とアプリの間で使う長いトークンを作ります: `openssl rand -hex 32`。この値は自分だけが保管してください。
4. `cd worker` を実行してから、`npx wrangler login` と `npx wrangler deploy` を実行します。
5. 次のコマンドをそれぞれ実行し、表示された入力欄に値を貼り付けます（値はコマンド行や Git に書きません）:

   ```bash
   npx wrangler secret put PAPAGO_CLIENT_ID
   npx wrangler secret put PAPAGO_CLIENT_SECRET
   npx wrangler secret put PAPAGO_PROXY_TOKEN
   ```

   `PAPAGO_PROXY_TOKEN` には手順 3 で作ったトークンを入力します。デプロイ先が `https://<worker名>.<account名>.workers.dev` の形式で表示されます。
6. アプリの「翻訳方法」で **Papago** を選び、「Papago 接続設定」に Worker URL と同じ `PAPAGO_PROXY_TOKEN` を入力して保存します。

トークンはブラウザの現在のタブを閉じるまでだけ保存されます。Worker URL は設定に保存されます。独自ドメインや別の公開元を使う場合は `worker/wrangler.toml` の `ALLOWED_ORIGINS` を変更して Worker を再デプロイしてください。

## GitHub Pages で公開

`main` に push すると `.github/workflows/deploy-pages.yml` が自動デプロイします。
初回に失敗したら **Settings → Pages → Source を「GitHub Actions」** にして再実行してください。
公開後は `https://amepo.github.io/honyaku/` で開けます。

## 注意・制限

- 音声認識そのものはブラウザ（Apple / Google）のサーバーで処理されるので **ネット接続が必要**。音声はそれぞれのサービスに送られます。
- Google 翻訳を選ぶか自動翻訳が Google に切り替わった場合、認識テキストや入力した日本語が Google に送られます。Papago を選んだ場合は Worker を経由して Papago に送られます。端末内翻訳が選ばれた場合は翻訳テキストを端末外に送信しません。
- BGM が大きい配信や、複数人が同時にしゃべる場面は精度が落ちます。
- 精度・連続認識の安定性はブラウザ次第。iPhone Safari は数十秒ごとに区切られることがありますが、自動で再開します。
- Firefox は非対応。
- 録音済みの音声ファイル（mp3 / m4a）の文字起こしはできません（Web Speech API はマイク入力のみ）。
  必要になったら Whisper 系 API を使う形で追加できます。

## 構成

```
index.html          画面
css/style.css       スタイル（ライト / ダーク対応）
js/app.js           音声認識・UI
js/transcript.js    文字起こしデータのロジック（DOM 非依存・テスト対象）
js/translate.js     翻訳エンジンと翻訳キュー（DOM 非依存・テスト対象）
js/reading.js       ハングル → カナ / ローマ字 の読み変換（DOM 非依存・テスト対象）
worker/              Papago API キーを安全に扱う Cloudflare Worker\nsw.js               オフライン用 Service Worker
tests/              node:test のユニットテスト
tools/serve.js      依存なしの開発サーバー
```
