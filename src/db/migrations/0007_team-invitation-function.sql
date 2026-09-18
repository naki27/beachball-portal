-- 選手・代表者としての招待の画面（設計書 §5.15「◯◯チームから選手（山田太郎）として招待されています」）と
-- 承諾後の移動先に、チーム ID と人物の氏名が要るので、my_pending_invitations()（0003）を作り直す（戻り値の型が変わる）
-- 返すのは、ログイン中のユーザー（app.user_id）の確認済みメールアドレス宛ての返事待ちだけ（変更なし）
drop function if exists my_pending_invitations();
--> statement-breakpoint
create function my_pending_invitations()
  returns table (invitation_id uuid, association_name text, association_slug text,
                 team_id uuid, team_name text, kind text, member_name text, inviter_name text, expires_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select i.id, a.name, a.slug, t.id, t.name, i.kind, m.name, iu.display_name, i.expires_at
      from team_invitations i
      join users u  on u.email = i.email and u.email_verified_at is not null and u.deleted_at is null
                   and u.id = current_user_id()
      join teams t  on t.id = i.team_id and t.deleted_at is null
      join associations a on a.id = i.association_id
      left join members m on m.id = i.member_id and m.deleted_at is null
      left join users iu on iu.id = i.invited_by
     where i.status = 'pending' and i.expires_at > now()
    union all
    select i.id, a.name, a.slug, null, null, 'association_admin', null, iu.display_name, i.expires_at
      from association_admin_invitations i
      join users u  on u.email = i.email and u.email_verified_at is not null and u.deleted_at is null
                   and u.id = current_user_id()
      join associations a on a.id = i.association_id
      left join users iu on iu.id = i.invited_by
     where i.status = 'pending' and i.expires_at > now()
  $$;
--> statement-breakpoint
alter function my_pending_invitations() owner to app_definer;
--> statement-breakpoint
revoke execute on function my_pending_invitations() from public;
--> statement-breakpoint
grant execute on function my_pending_invitations() to app_user;
