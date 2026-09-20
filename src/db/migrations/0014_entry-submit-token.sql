-- 申込の送信用のワンタイムの値（設計書 §5.5「入力ページを開いたときに発行し、送信時に消費する」・ADR 0024）
-- 二重送信を DB の一意制約で止める。完了後に「戻る」で再送しても、同じ値なら 2 件目にならず 1 件目を返せる

alter table entries add column submit_token uuid;
--> statement-breakpoint
create unique index entries_submit_token_uk on entries (association_id, submit_token) where submit_token is not null;
