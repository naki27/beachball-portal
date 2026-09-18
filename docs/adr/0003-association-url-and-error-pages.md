# 0003 協会の URL の解決と、403 / 404 / 409 の返し方

## 背景

設計書 §5.14「URL とテナント」は解決順（予約語 → 現行のスラッグ → 旧スラッグは 308 → 404）を、§3.1 は 404 / 403 / 409 の判定規則と「リダイレクトしない」ことを決めている。実装で決めが要ったのは次の点。

1. `association_slug_history` はテナントの表で RLS が効く（ADR 0002）。しかし旧スラッグの解決は、協会が決まる前（`SET LOCAL` の前）に行う
2. Next.js（App Router）で、画面に HTTP 403 を返す方法。ページ（Server Component）は状態コードを直接は返せない
3. エラーページの「協会のトップへ戻る」の行き先を、`not-found.tsx` / `forbidden.tsx`（params を受け取れない）でどう決めるか
4. 409 をページの状態コードにするか

## 決定

1. **旧スラッグの解決は `SECURITY DEFINER` 関数 `resolve_association_slug(text)`**（所有者 app_definer。現行のスラッグ → 旧スラッグの順に 1 行だけ返す）で行う。呼ぶのは `src/lib/repo/associations.ts` だけ。解決の全体は `src/lib/resolve-association.ts` の `resolveAssociation(slug)` の 1 か所（React の `cache` で 1 リクエスト 1 回）
2. **403 は Next.js の `forbidden()`**（`next.config.ts` の `experimental.authInterrupts: true`）で返し、`forbidden.tsx` を描画する。ページから `forbidden.tsx` へ値は渡せない（React の `cache` の入れ物も境界の描画では共有されなかった・A-09 で判明）ので、**3 種類の文言は `forbidden.tsx` が自分で決める**: 未ログイン／セッション切れは `getPrincipal()` の `sessionState`、「誰なら見られるか」は URL の規則の表（`src/lib/page/forbidden.ts` の `whoCanSee()`）。画面を足すときはこの表に規則を足す。**`unauthorized()`（401）は使わない**（設計は未ログインも 403）。Route Handler は `jsonError(403, …)` の Response を返す
3. **`src/proxy.ts` が `x-url`（パスと検索文字列）を request header に入れ**、`requireAssociation()` の 308 の行き先と、エラーページの「協会のトップへ戻る」の行き先に使う。proxy は DB に触らない
4. **409 はページの HTTP 状態コードにしない**。フォームの送信（Server Action / API）の応答に 409 を付け、画面には `ConflictScreen` の部品を埋め込んで理由と問い合わせの導線を出す
5. ログインへの導線は `/login?next=<元の URL>`。受け口（A-08）はログイン後に `next` へ戻す（外部の URL は受け付けない）

## 理由

- 1: RLS を外したロールでの横断クエリは使わない（§5.14「協会をまたぐ画面」）。関数なら返す列を ID とスラッグに限定できる
- 2: `forbidden()` は Next.js が 403 の状態コードと `forbidden.tsx` の描画を面倒みる唯一の方法。自前で状態コードを返す手段はない。experimental だが Next 15.1 から続いていて、外すときは `denyPage()` の中身を差し替えるだけで済む
- 3: `headers()` はどのサーバーコンポーネントからも読める。`params` が届かない `not-found.tsx` でも協会を決められる
- 4: 409 になる場面（締切後の申込ページなど）は、ページ自体は見せて理由を伝えるのが設計の意図（§4.4「受付は終了しました」）。状態コードは API の利用者（フォームの送信）にだけ意味がある

## 却下した代替案

- `association_slug_history` に「誰でも読める」ポリシーを足す: 表ごとにポリシーの形が変わり、ADR 0002 の「同じ形」の決まりが崩れる
- proxy（middleware）で DB を引いて 308 する: すべてのリクエストで DB を読むことになり、画面の描画でもう一度読む。解決の実装が 2 か所になる
- 403 を `error.tsx` で描画する: `error.tsx` はクライアント部品で、本番ではエラーの中身が渡らない（状態コードも理由も分からない）
- 未ログインを 401（`unauthorized()`）にする: 設計書 §3.1 が「未ログインも 403」と決めている
