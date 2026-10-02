# 0026 大会資料の公開用ファイルは、公開用バケットを独自ドメインで配信する（第 1 案）

**`0027` で置き換え**（D-4 が「任せられない」だったため、第 2 案の Workers に変更）

## 背景

設計書 §5.9「配信の仕組み」は、公開用の URL の配信方法を Phase 0 で決めるとして 3 案を挙げている。

1. R2 の公開用バケットを独自ドメイン（例: `files.entry.…`）で配信する（Cloudflare のキャッシュが効く・転送料 0）
2. Cloudflare Workers で公開用バケットを読み出して返す
3. アプリが R2 から読み出して返す（Cloud Run の転送量に料金がかかる）

`docs/p0-tasks.md` の「C を始める前に」は、決めた案を `docs/adr/` か `docs/setup.md` に書いておくよう求めている。Phase 0 の結果は記録に残っていなかった。

## 決定

**第 1 案を前提に作る。** アプリは、公開用バケットに置いたファイルの名前に `PUBLIC_FILES_BASE_URL` を付けた URL へ 302 で転送するだけにする（`src/lib/storage/*.ts` の `publicUrl`）。

- 公開用のファイルには `Content-Type: application/pdf`・`Content-Disposition: inline; filename*=UTF-8''<タイトル>.pdf`・`Cache-Control: public, max-age=3600` を付けて置く（R2 はこれをそのまま返す）
- ローカルは `STORAGE_DRIVER=local` で `.local-storage/public/` に置き、開発時だけのルート `/dev-files/<名前>` が返す（`PUBLIC_FILES_BASE_URL` の既定は `http://localhost:3000/dev-files`。production では 404）
- 第 2 案に切り替える場合も、コードは変えずに `PUBLIC_FILES_BASE_URL` を Workers の URL にするだけでよい
- 第 3 案が必要になった場合は、`/dev-files` と同じ形のルートを本番でも有効にし、R2 から読んで返す（費用を確かめてから。X-05）

Cloudflare でドメインを扱えるかの確認と、実際のバケット・ドメインの設定は X-05 で行う。

## 理由

- 設計書が第一候補としており、費用（転送料 0・キャッシュ）と手間（アプリの変更なし）がいちばん小さい
- 第 1 案と第 2 案でアプリ側の実装が同じなので、Phase 0 の結論を待たずに 1c を進められる
- 利用者が共有するのはアプリの URL（期限なし）なので、配信方法をあとで変えても共有済みのリンクは壊れない

## 却下した代替案

- **アプリが R2 から読んで返す（第 3 案）を既定にする**: 大会冊子は繰り返し開かれるため Cloud Run の転送量が読めない。キャッシュも効かない。最後の手段にとどめる
- **署名 URL（v0.9 まで）**: 設計書 v0.9.1 で「期限なしで開ける」に確定済み。LINE で共有してあとから開く使い方に合わない
