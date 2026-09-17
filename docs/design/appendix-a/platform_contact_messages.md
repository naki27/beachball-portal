```sql
-- サイトの運営者宛ての問い合わせ（テナントに属さない・§5.10・v0.9.1）。運営管理者が /platform で読む
create table platform_contact_messages (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id),
  subject_type   text not null check (subject_type in ('ログイン','削除','その他')),
  sender_name    text not null,
  sender_email   text not null,
  body           text not null,
  status         text not null default 'new' check (status in ('new','done')),
  created_at     timestamptz not null default now()
);
```
