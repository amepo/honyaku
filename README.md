# honyaku — 韓国語 文字起こし

ブラウザだけで動く **韓国語のリアルタイム文字起こし** アプリ。
マイクに向かって韓国語を話すと、その場でハングルに書き起こします。

- インストール不要・無料・API キー不要（ブラウザ標準の Web Speech API、`ko-KR`）
- iPhone（Safari）/ Android・PC（Chrome, Edge）対応。PWA としてホーム画面に追加可
- 話し途中の文字もグレーでリアルタイム表示 → 確定したら行として追加
- 無音でブラウザが止めても自動で再開（長時間の聞き取り向け）
- 行ごとに コピー / Google 翻訳（韓→日）/ 削除
- 全文コピー・`.txt` 保存（時刻付きにも切替可）・文字サイズ変更
- 記録は端末内（localStorage）に自動保存。録音中は画面スリープを防止（対応ブラウザのみ）

## 使い方

```bash
npm start   # → http://localhost:5174/
npm test    # ロジックのユニットテスト（Node 22、依存なし）
```

マイクは **https か localhost** でしか使えません。スマホで試すなら GitHub Pages で公開するのが楽です。

## GitHub Pages で公開

`main` に push すると `.github/workflows/deploy-pages.yml` が自動デプロイします。
初回に失敗したら **Settings → Pages → Source を「GitHub Actions」** にして再実行してください。
公開後は `https://amepo.github.io/honyaku/` で開けます。

## 注意・制限

- 音声認識そのものはブラウザ（Apple / Google）のサーバーで処理されるので **ネット接続が必要**。
  音声はそれぞれのサービスに送られます。
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
sw.js               オフライン用 Service Worker
tests/              node:test のユニットテスト
tools/serve.js      依存なしの開発サーバー
```
