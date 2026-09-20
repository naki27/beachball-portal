-- 人物を物理削除するとき、申込の変更履歴（entry_audits）の JSON に残る氏名を「（削除済み）」に置き換える（設計書 §5.16）
-- 履歴そのものは消させない・作り直させない。書き換えてよいのは before / after の 2 列だけにする（列を指定した GRANT）

grant update (before, after) on entry_audits to app_user;
