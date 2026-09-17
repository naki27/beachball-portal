```sql
create table user_totp (
  user_id          uuid primary key references users(id) on delete cascade,
  secret_encrypted bytea not null,             -- MFA_ENCRYPTION_KEY で暗号化
  confirmed_at     timestamptz
);
```
