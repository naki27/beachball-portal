```sql
-- 物理削除の記録（§5.16）。消した中身は持たない
create table deletion_logs (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid references associations(id),
  table_name      text not null,
  record_id       uuid not null,
  cascaded_count  int not null default 0,     -- 一緒に消えた行の数
  reason          text,                       -- 保存期間満了 / 本人からの依頼 / 誤登録 など
  deleted_by      uuid not null references users(id),
  deleted_at      timestamptz not null default now()
);
```
