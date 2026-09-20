-- 削除済みデータの物理削除（設計書 §5.16・A-26）。問い合わせだけ delete の権限がなかったので足す
-- （teams・team_members・members・member_aliases・team_invitations・team_admins は 0003 で付いている）
grant delete on contact_messages to app_user;
