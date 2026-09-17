```sql
create table member_aliases (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null,
  member_id       uuid not null,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade,
  name_normalized text not null,
  kana_normalized text,
  created_at      timestamptz not null default now(),
  unique (member_id, name_normalized, kana_normalized)
);
```
