```sql
create table tournament_documents (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  tournament_id uuid not null,
  doc_type      text not null check (doc_type in ('大会冊子','要項','組み合わせ','結果','その他')),
  title         text not null,
  storage_key   text not null,                -- 保管用バケット（非公開）のキー
  public_key    text,                         -- 公開用バケットのキー。公開中だけ入る。推測されにくいランダムな名前（§5.9）
  content_type  text not null check (content_type = 'application/pdf'),  -- PDF のみ（§5.9）
  size_bytes    int not null,
  is_public     boolean not null default true,
  sort_order    int not null default 0,
  uploaded_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  foreign key (association_id, tournament_id) references tournaments (association_id, id) on delete cascade
);
```
