-- アカウントの削除（設計書 §5.19）。協会をまたいで消すので SECURITY DEFINER 関数にする（§5.14）
-- 対象は「ログイン中のユーザー」だけ（引数でほかの人を指定できないように、app.user_id から読む）

-- この関数のためだけに、所有者（app_definer。ログインできない。RLS は素通し）に書き込みの権限を足す
-- アプリのロール（app_user）の権限は変えない
grant update on members, team_invitations, association_admin_invitations, users to app_definer;
--> statement-breakpoint
grant select, delete on sessions, login_codes to app_definer;
--> statement-breakpoint

-- 削除できない理由（代表者・協会の管理者・運営管理者）。ないときは null
create function my_account_deletion_block() returns text
  language sql stable security definer set search_path = public as $$
    select case
      when exists (select 1 from platform_admins p where p.user_id = current_user_id()) then 'platform_admin'
      when exists (select 1 from association_admins aa where aa.user_id = current_user_id()) then 'association_admin'
      when exists (
        select 1 from team_admins ta
          join teams t on t.id = ta.team_id and t.deleted_at is null
         where ta.user_id = current_user_id() and ta.revoked_at is null
      ) then 'team_admin'
      else null
    end
  $$;
--> statement-breakpoint
alter function my_account_deletion_block() owner to app_definer;
--> statement-breakpoint
revoke execute on function my_account_deletion_block() from public;
--> statement-breakpoint
grant execute on function my_account_deletion_block() to app_user;
--> statement-breakpoint

-- 削除の本体（1 トランザクション）。blocked_by が null でなければ、何も変えない
--   users を論理削除し、メールアドレスを元に戻せない値（引数）に置き換え、表示名を消す
--   人物との紐づけ（members.user_id）を外す。人物・選手一覧・申込は協会のデータとして残る
--   自分が送った返事待ちの招待と、自分のアドレス宛ての返事待ちの招待を取り消す
--   セッションをすべて終了する
create function delete_my_account(new_email text)
  returns table (blocked_by text, unlinked_members integer, cancelled_invitations integer)
  language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_user_id();
  my_email citext;
  block text;
  unlinked integer := 0;
  cancelled integer := 0;
  n integer;
begin
  select u.email into my_email from users u where u.id = me and u.deleted_at is null;
  if my_email is null then
    raise exception 'アカウントがありません';
  end if;

  select my_account_deletion_block() into block;
  if block is not null then
    return query select block, 0, 0;
    return;
  end if;

  update members m set user_id = null, updated_at = now() where m.user_id = me;
  get diagnostics unlinked = row_count;

  update team_invitations i set status = 'cancelled', responded_at = now()
   where i.status = 'pending' and (i.invited_by = me or i.email = my_email);
  get diagnostics n = row_count;
  cancelled := cancelled + n;

  update association_admin_invitations i set status = 'cancelled', responded_at = now()
   where i.status = 'pending' and (i.invited_by = me or i.email = my_email);
  get diagnostics n = row_count;
  cancelled := cancelled + n;

  delete from sessions s where s.user_id = me;
  delete from login_codes c where c.user_id = me;

  update users u
     set email = new_email, display_name = null, email_verified_at = null,
         deleted_at = now(), deleted_by = me, updated_at = now()
   where u.id = me;

  return query select null::text, unlinked, cancelled;
end
$$;
--> statement-breakpoint
alter function delete_my_account(text) owner to app_definer;
--> statement-breakpoint
revoke execute on function delete_my_account(text) from public;
--> statement-breakpoint
grant execute on function delete_my_account(text) to app_user;
