-- 大会資料の RLS とロールの権限（設計書 §5.14「漏れを機構で防ぐ」・docs/adr/0002）
-- 0003・0012 と同じ「enable → force → policy → grant」をそのまま写す
-- app_job は日次ジョブの後始末（公開用バケットに残った迷子のファイルを消す・§6.5.1 ⑥）で読む

alter table tournament_documents enable row level security;
--> statement-breakpoint
alter table tournament_documents force row level security;
--> statement-breakpoint
create policy tournament_documents_tenant on tournament_documents
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on tournament_documents to app_user, app_job;
--> statement-breakpoint
grant select on tournament_documents to app_backup;
