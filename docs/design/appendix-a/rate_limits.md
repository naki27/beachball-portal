```sql
-- レート制限の回数（§9.2）。複数インスタンスで共有するため DB に置く。古い行は日次ジョブで削除
create table rate_limits (
  key          text not null,                 -- 例: login_request:email:<sha256>, login_verify:ip:<ip>, suggest:user:<id>
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);
```
