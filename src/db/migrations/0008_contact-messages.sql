CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"tournament_id" uuid,
	"entry_id" uuid,
	"user_id" uuid,
	"subject_type" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "contact_messages_subject_type_check" CHECK ("contact_messages"."subject_type" in ('変更', '取消', 'ログイン', '削除', 'その他')),
	CONSTRAINT "contact_messages_status_check" CHECK ("contact_messages"."status" in ('new', 'done'))
);
--> statement-breakpoint
CREATE TABLE "platform_contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"subject_type" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_contact_messages_subject_type_check" CHECK ("platform_contact_messages"."subject_type" in ('ログイン', '削除', 'その他')),
	CONSTRAINT "platform_contact_messages_status_check" CHECK ("platform_contact_messages"."status" in ('new', 'done'))
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_contact_messages" ADD CONSTRAINT "platform_contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contact_messages_status_idx" ON "contact_messages" ("association_id", "status", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "contact_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "contact_messages_tenant" ON "contact_messages"
	USING (association_id = current_association_id())
	WITH CHECK (association_id = current_association_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contact_messages" TO app_user, app_job;
--> statement-breakpoint
GRANT SELECT ON "contact_messages" TO app_backup, app_definer;
--> statement-breakpoint
-- テナントに属さない表（0003 の「テナントに属さない表」と同じで、RLS は置かず権限だけ。読み書きの制限はアプリ側の運営管理者の検査）
GRANT SELECT, INSERT, UPDATE ON "platform_contact_messages" TO app_user;
--> statement-breakpoint
GRANT SELECT ON "platform_contact_messages" TO app_job, app_backup, app_definer;
