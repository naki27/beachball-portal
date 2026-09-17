```sql
-- contact_messages の entry_id の外部キーは entries の作成後に追加する（下記）
create table contact_messages (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  tournament_id  uuid references tournaments(id) on delete set null,
  entry_id       uuid,                          -- 申込から開いたとき（§5.10）
  user_id        uuid references users(id),
  subject_type   text not null check (subject_type in ('変更','取消','ログイン','削除','その他')),
  sender_name    text not null,
  sender_email   text not null,
  body           text not null,
  status         text not null default 'new' check (status in ('new','done')),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id)
);
create index contact_messages_status_idx on contact_messages (association_id, status, created_at desc);
```
