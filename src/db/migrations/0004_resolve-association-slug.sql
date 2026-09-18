-- URL のスラッグから協会を決める関数（設計書 §5.14「URL とテナント」の解決順 ②③・docs/adr/0003）
-- association_slug_history はテナントの表で RLS が効くため、協会が決まる前に読むには SECURITY DEFINER が要る
-- 返すのは協会の ID と現行のスラッグだけ。現行のスラッグ → 旧スラッグの順に 1 行（両方合わせて一意なので、当たるのは最大 1 つ）
create or replace function resolve_association_slug(p_slug text)
  returns table (association_id uuid, slug text, redirected boolean)
  language sql stable security definer set search_path = public as $$
    select x.association_id, x.slug, x.redirected
      from (
        select a.id as association_id, a.slug, false as redirected, 0 as priority
          from associations a
         where a.slug = p_slug
        union all
        select h.association_id, a.slug, true as redirected, 1 as priority
          from association_slug_history h
          join associations a on a.id = h.association_id
         where h.slug = p_slug
      ) x
     order by x.priority
     limit 1
  $$;
--> statement-breakpoint
alter function resolve_association_slug(text) owner to app_definer;
--> statement-breakpoint
revoke execute on function resolve_association_slug(text) from public;
--> statement-breakpoint
grant execute on function resolve_association_slug(text) to app_user;
--> statement-breakpoint
-- 関数が旧スラッグの表を読めるように（associations は 0003 で付与済み）
grant select on association_slug_history to app_definer;
