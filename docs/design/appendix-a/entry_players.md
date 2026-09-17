```sql
-- 申込時点のスナップショット（members が後から直されても申込内容は変わらない）
create table entry_players (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null,
  entry_id        uuid not null,
  foreign key (association_id, entry_id)  references entries (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete set null (member_id),
  position        int not null,
  name            text not null,
  kana            text,
  birth_date      date,                                 -- 申込時は必須（アプリで検査）。人物の物理削除時に NULL へ匿名化（§5.16）
  sex             text not null check (sex in ('male','female')),
  age_at_event    int,                                  -- 基準日時点の満年齢（保存時に確定。基準日の変更は管理者の確定操作で再計算・§5.4）
  name_normalized text not null,
  kana_normalized text,
  member_id       uuid,                                 -- 人物の物理削除で NULL（match_type = unmatched・§8.3）
  match_type      text check (match_type in ('picked','auto_exact','auto_new','unmatched')),
  unique (entry_id, position)
);
```
