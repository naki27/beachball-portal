## 付録 C. サジェスト SQL

```sql
-- $1 = normalizeName(q)（正規化後 2 文字未満ならアプリで呼ばない・§8.4）、$2 = association_id、
-- $3 = ログイン中のユーザー ID、$4 = 協会員だけか（boolean）、$5 = 大会の開催日の年度
-- 類似度の閾値は既定値に頼らず、同じトランザクションで明示する（% 演算子で GIN インデックスを使うため）
select set_config('pg_trgm.similarity_threshold', '0.3', true);

select s.member_id, s.name, s.kana, s.birth_date, s.sex,
       array_agg(distinct s.team_name order by s.team_name)                 as team_names,
       bool_or(coalesce(s.name_normalized like $1 || '%' or s.kana_normalized like $1 || '%', false)) as is_prefix,
       max(greatest(similarity(s.name_normalized, $1),
                    coalesce(similarity(s.kana_normalized, $1), 0)))        as sim,
       exists (select 1 from memberships ms
                where ms.association_id = $2 and ms.member_id = s.member_id
                  and ms.year = $5 and ms.status = 'approved' and ms.deleted_at is null) as is_member,
       max(s.entry_count) as entry_count, max(s.last_entry_at) as last_entry_at
from player_suggestions s
join team_admins ta on ta.team_id = s.team_id
                  and ta.user_id = $3 and ta.revoked_at is null   -- 代表者を務めるチームの選手だけ（v0.9.2・§8.4）
where s.association_id = $2                    -- テナントで必ず絞る（RLS と二重）
  and length($1) >= 2
  and (s.name_normalized like '%' || $1 || '%'
   or s.kana_normalized like '%' || $1 || '%'
   or (length($1) >= 3 and (s.name_normalized % $1 or s.kana_normalized % $1)))
group by s.member_id, s.name, s.kana, s.birth_date, s.sex
having not $4 or exists (select 1 from memberships ms
                          where ms.association_id = $2 and ms.member_id = s.member_id
                            and ms.year = $5 and ms.status = 'approved' and ms.deleted_at is null)
order by is_prefix desc, sim desc, entry_count desc, last_entry_at desc nulls last
limit 10;
```

