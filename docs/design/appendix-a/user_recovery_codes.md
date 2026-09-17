```sql
create table user_recovery_codes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at   timestamptz
);
```
