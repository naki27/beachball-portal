# 0004 画面の共通部品で決めたこと

## 背景

A-06 で設計書 §4.3・§4.5 の共通部品（ボタン・入力欄・メッセージ・「元に戻す」の帯・誤りの要約・骨組み・電波の帯・一時保存）とレイアウトを作った。設計書に書かれていない、または現在の規格と合わない点があった。

## 決定

1. **ふりがなの `inputmode="kana"` は付けない**。`inputmode` の値は `none / text / decimal / numeric / tel / search / email / url` だけで、`kana` は現在の HTML の規格にない（ブラウザは無視する）。ふりがな欄は `inputMode="text"` のままにし、A-16・A-17 で必要なら `autocomplete` や IME の案内で補う
2. **ヘッダは区画ごとの layout が出す**。協会に属さないページは route group `src/app/(site)/`（ヘッダはサイト名）、協会のページは `src/app/[slug]/`（ヘッダは協会名。タブの題名は `%s｜協会名`）。フッタと電波の帯はルートの layout に置く。ルートの `not-found.tsx` / `forbidden.tsx` は協会の layout の外で描画されるので、自分でサイト名のヘッダを出す
3. **動きの長さは `tokens.css` の `--motion-fast / --motion-base / --motion-slow` の 3 つ**（§4.5「実装」の名前に合わせ、L-03 の `--motion-normal` は `--motion-base` に改名）。`prefers-reduced-motion: reduce` では 4 つの変数を 0ms にする。文字の表示は変えない
4. **一時保存のキーは `draft:<協会 ID>:<画面>[:<対象 ID>]`**（`src/lib/draft.ts` の `draftKey()`）。ログアウトのときは `draft:` で始まるキーだけを全部消す（`clearAllDrafts`）。7 日を過ぎたものは読むときに消す
5. **`/dev/ui` は `NODE_ENV=production` で 404**。予約語に `dev` を足す

## 理由

- 1: 型（React の `inputMode`）と規格に合わせる。効かない属性を書いても利用者には何も起きない
- 2: Next.js の layout の入れ子では、ルートの layout に置いたヘッダを協会の layout から差し替えられない
- 3: 変数を 0ms にすれば、揺れ・スライド・描画のアニメーションはすべて「一瞬で終わる」だけになり、部品ごとに `@media` を書かなくてよい
- 4: 生年月日を含むので、消し忘れがないように「このサイトの一時保存」をキーの形で見分けられるようにする

## 却下した代替案

- 動きのライブラリ（framer-motion など）を入れる: §4.5「実装」が CSS の transition / animation だけとしている
- ヘッダをルートの layout に置き、`usePathname` でクライアント側に協会名を出す: 協会名を取るためにクライアントから API を呼ぶことになり、最初の描画で名前が出ない
