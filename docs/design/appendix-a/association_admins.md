```sql
-- 論理削除の列（deleted_at / deleted_by）は §5.16 の対象テーブルすべてに付け、以下の DDL に明記する（v0.9）。
-- 一意制約は削除済みを除く部分インデックスにする（§5.16）。
-- テナントに属するテーブルはすべて association_id を持ち、子は (association_id, 親の id) の複合外部キーで親を参照する（§5.14）。

-- 協会の管理者（users.role の代わり。テナントごとに持つ）
create table association_admins (
  association_id uuid not null references associations(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  granted_by     uuid references users(id),       -- 招待した運営管理者（§5.14）
  mfa_enroll_by  timestamptz,                     -- この日時までに 2 段階認証を登録（承諾 + 7 日【仮】・§9.4・P1）
  primary key (association_id, user_id)
);
```
