```sql
-- ============================================================
-- 行レベルセキュリティ（採用する場合・§5.14）。v0.9 でロールの分離を追加
```
```sql
-- ============================================================
-- DB の日付は日本時間で扱う（current_date・age() のずれを防ぐ・§7.0）
-- alter database <db> set timezone = 'Asia/Tokyo';

-- ロール: 所有者（マイグレーション）／アプリ／ジョブ／バックアップ／関数の定義者
-- create role app_owner   login;                 -- テーブルの所有者。MIGRATION_DATABASE_URL
-- create role app_user    login;                 -- アプリ。所有者ではなく BYPASSRLS なし。DATABASE_URL
-- create role app_job     login;                 -- 日次ジョブ。協会ごとに SET LOCAL する
-- create role app_backup  login bypassrls;       -- pg_dump 専用。SELECT のみ
-- create role app_definer nologin bypassrls;     -- 下の SECURITY DEFINER 関数の所有者（ログインできない）
-- grant select, insert, update, delete on <テナントに属する表> to app_user, app_job;
-- grant select on all tables in schema public to app_backup;
-- revoke all on platform_admins from app_user; grant select on platform_admins to app_user;

-- テナントに属する全テーブル（§5.14 の一覧）に同じ形で張る。例:
-- alter table teams enable row level security;
-- alter table teams force  row level security;   -- 所有者で接続しても効かせる
-- create policy teams_tenant on teams
--   using      (association_id = current_setting('app.association_id', true)::uuid)
--   with check (association_id = current_setting('app.association_id', true)::uuid);
-- アプリはトランザクション冒頭で SET LOCAL app.association_id = '…' と SET LOCAL app.user_id = '…' を実行する

-- 協会をまたぐ画面のための関数（§5.14「協会をまたぐ画面」）。所有者は app_definer
-- create function my_association_ids() returns setof uuid
--   language sql stable security definer set search_path = public as $$
--     select association_id from association_admins
--      where user_id = current_setting('app.user_id', true)::uuid
--     union
--     select association_id from team_admins
--      where user_id = current_setting('app.user_id', true)::uuid and revoked_at is null
--     union
--     select association_id from members
--      where user_id = current_setting('app.user_id', true)::uuid and deleted_at is null
--   $$;
-- create function my_pending_invitations()
--   returns table (invitation_id uuid, association_name text, association_slug text,
--                  team_name text, kind text, inviter_name text, expires_at timestamptz)
--   language sql stable security definer set search_path = public as $$
--     select i.id, a.name, a.slug, t.name, i.kind, iu.display_name, i.expires_at
--       from team_invitations i
--       join users u  on u.email = i.email and u.email_verified_at is not null
--                    and u.id = current_setting('app.user_id', true)::uuid
--       join teams t  on t.id = i.team_id and t.deleted_at is null
--       join associations a on a.id = i.association_id
--       left join users iu on iu.id = i.invited_by
--      where i.status = 'pending' and i.expires_at > now()
--     union all
--     select i.id, a.name, a.slug, null, 'association_admin', iu.display_name, i.expires_at  -- テナント管理者の招待（v0.9.1）
--       from association_admin_invitations i
--       join users u  on u.email = i.email and u.email_verified_at is not null
--                    and u.id = current_setting('app.user_id', true)::uuid
--       join associations a on a.id = i.association_id
--       left join users iu on iu.id = i.invited_by
--      where i.status = 'pending' and i.expires_at > now()
--   $$;
-- create function platform_association_stats()   -- 運営管理者のみ。件数だけを返す（§5.14）
--   returns table (association_id uuid, teams bigint, members bigint, open_tournaments bigint)
--   language sql stable security definer set search_path = public as $$
--     select a.id,
--            (select count(*) from teams t where t.association_id = a.id and t.deleted_at is null),
--            (select count(*) from members m where m.association_id = a.id and m.deleted_at is null),
--            (select count(*) from tournaments x where x.association_id = a.id and x.status = 'open' and x.deleted_at is null)
--       from associations a
--      where exists (select 1 from platform_admins p
--                     where p.user_id = current_setting('app.user_id', true)::uuid)
--   $$;
-- revoke execute on all functions in schema public from public;
-- grant execute on function my_association_ids(), my_pending_invitations(), platform_association_stats() to app_user;

-- スケッチの player_suggestions はビューとして実装（ES 移行時はここを差し替える）
-- v0.9.2: 候補は「代表者を務めるチームの選手」だけにするため、人物 × 現役の所属チームの行で持つ（絞り込みは付録 C）
```
