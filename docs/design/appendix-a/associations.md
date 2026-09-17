```sql
-- テナント（協会）
create table associations (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  slug                     text not null unique,          -- sawara
  contact_email            citext,                        -- 問い合わせの転送先・メールの Reply-To（§5.10・§11）
  fiscal_year_start_month  int  not null default 4 check (fiscal_year_start_month between 1 and 12),
  theme_colors             jsonb,                         -- {base, main, accent} のカラーコード。NULL は既定の色（P1・§5.17）
  logo_storage_key         text,                          -- ロゴ（R2 のキー）
  billing_plan             text check (billing_plan in ('monthly','annual')),  -- 利用料のプラン（§5.20・P1）
  status                   text not null default 'active', -- 停止などの状態は利用料と一緒に決める（§5.20）。協会は物理削除しない
  created_at               timestamptz not null default now()
);
```
