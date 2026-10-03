-- 審判の資格（K-01）。members に審判級（A/B/C。なしは null）と審判No（数字 6 桁）を足す。どちらも任意
-- 名寄せのキーには入れない（§8.3）。RLS とロールの権限は members のものをそのまま使う（新しい表がないので追加なし）
ALTER TABLE "members" ADD COLUMN "referee_grade" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "referee_no" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_referee_grade_check" CHECK ("members"."referee_grade" is null or "members"."referee_grade" in ('a', 'b', 'c'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_referee_no_check" CHECK ("members"."referee_no" is null or "members"."referee_no" ~ '^[0-9]{6}$');