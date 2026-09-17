```sql
-- 領収書・請求書の PDF（§5.20・P1・v0.9.2）。ones が freee 請求書で発行したものを運営管理者がアップロードする
create table billing_documents (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  kind           text not null check (kind in ('receipt','invoice')),
  title          text not null,                 -- 例: 2027年4月分 領収書
  storage_key    text not null,                 -- R2 の保管用バケット（公開用には置かない）
  size_bytes     int not null,
  uploaded_by    uuid not null references users(id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id)
);
create index billing_documents_idx on billing_documents (association_id, created_at desc) where deleted_at is null;
```
