```sql
-- メールの送信記録と送信待ちの表を兼ねる（§11・v0.9）
create table mail_logs (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid references associations(id),   -- 確認番号など協会に属さないメールは NULL
  mail_type           text not null,
  to_email            text not null,
  user_id             uuid references users(id),
  entry_id            uuid references entries(id) on delete set null,
  params              jsonb not null default '{}',        -- 本文を組み立てるための ID だけ（本文・生年月日は入れない）
  status              text not null default 'queued'
                      check (status in ('queued','sent','failed','bounced')),
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  provider_message_id text,
  error               text,                                -- 個人情報を含めない
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index mail_logs_queue_idx on mail_logs (next_attempt_at) where status = 'queued';
create index mail_logs_daily_idx on mail_logs (sent_at) where status = 'sent';   -- 1 日の送信数（§11.2）
```
