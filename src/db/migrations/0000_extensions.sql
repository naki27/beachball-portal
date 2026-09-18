-- 拡張（設計書 付録 A「拡張」）。pg_trgm は名寄せ・サジェスト、citext は大文字小文字を区別しない列（メールアドレスなど）
-- どちらも trusted な拡張なので、app_owner（DB に create 権限あり）で作れる
create extension if not exists pg_trgm;
--> statement-breakpoint
create extension if not exists citext;
