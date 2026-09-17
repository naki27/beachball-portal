```sql
create table entries (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null,
  tournament_id       uuid not null,
  category_id         uuid not null,               -- 部門は必須（§5.5。v0.9 で NOT NULL に）
  team_id             uuid not null,
  created_by          uuid not null references users(id),
  team_name           text not null,               -- 申込時点のスナップショット
  note                text,                        -- 連絡先はチーム（teams）に一本化（v0.9 で representative_name / contact_phone を削除）
  status              text not null default 'submitted'
                      check (status in ('submitted','cancelled')),
  needs_admin_check   boolean not null default false,  -- 合計年齢部門など、運営の確認対象
  submitted_at        timestamptz not null default now(),
  cancelled_at        timestamptz,
  updated_by          uuid references users(id),   -- 締切後の管理者編集を記録
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,                 -- 論理削除（取消 = status とは別・§5.16）
  deleted_by          uuid references users(id),
  unique (association_id, id),
  foreign key (association_id, tournament_id) references tournaments           (association_id, id) on delete cascade,
  foreign key (association_id, category_id)   references tournament_categories (association_id, id) on delete cascade,
  foreign key (association_id, team_id)       references teams                 (association_id, id)  -- 申込のあるチームは物理削除できない（§5.16）
  -- 部門がその大会のものであることはアプリで検査する
);
alter table contact_messages
  add foreign key (association_id, entry_id) references entries (association_id, id) on delete set null (entry_id);
create index entries_tournament_idx on entries (tournament_id, status) where deleted_at is null;
create index entries_created_by_idx on entries (created_by, submitted_at desc);
create index entries_team_idx       on entries (team_id, submitted_at desc);
```
