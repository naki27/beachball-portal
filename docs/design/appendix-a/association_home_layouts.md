```sql
-- トップページの構成（§5.17）。1 版 1 行。公開中はテナントに 1 行だけ
create table association_home_layouts (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  status         text not null check (status in ('draft','published','archived')),
  blocks         jsonb not null,               -- [{type, visible, settings, body}] 保存時に zod で検査
  created_by     uuid,
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  published_by   uuid
);
create unique index home_layouts_published_uk
  on association_home_layouts (association_id) where status = 'published';
create unique index home_layouts_draft_uk
  on association_home_layouts (association_id) where status = 'draft';
```
