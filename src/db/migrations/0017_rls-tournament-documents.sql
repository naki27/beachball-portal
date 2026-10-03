-- 大会資料の表の RLS とロールの権限（設計書 §5.14「漏れを機構で防ぐ」・付録 A。書き方の決まりは docs/adr/0002）
-- 0003・0012 と同じ「enable → force → policy → grant」の 5 文をそのまま写す
-- app_job は日次ジョブの後始末（公開用・保管用の消し忘れの掃除、物理削除・C-02）で読み書きする

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
