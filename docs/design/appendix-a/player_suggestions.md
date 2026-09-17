```sql
create view player_suggestions with (security_invoker = true) as  -- 呼び出したロール（app_user）の RLS を効かせる
select m.id as member_id, m.association_id, m.name, m.kana,
       m.name_normalized, m.kana_normalized, m.birth_date, m.sex,
       m.entry_count, m.last_entry_at,
       tm.team_id, t.name as team_name
from members m
join team_members tm on tm.member_id = m.id and tm.left_at is null and tm.deleted_at is null
join teams t on t.id = tm.team_id and t.deleted_at is null and t.status = 'active'
where m.status in ('active','needs_review')
  and m.deleted_at is null;                    -- 論理削除済みはサジェストに出さない（§5.16）

```
