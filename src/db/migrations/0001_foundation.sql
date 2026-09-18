CREATE TABLE "associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"contact_email" "citext",
	"fiscal_year_start_month" integer DEFAULT 4 NOT NULL,
	"theme_colors" jsonb,
	"logo_storage_key" text,
	"billing_plan" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "associations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "associations_fiscal_year_start_month_check" CHECK ("associations"."fiscal_year_start_month" between 1 and 12),
	CONSTRAINT "associations_billing_plan_check" CHECK ("associations"."billing_plan" in ('monthly', 'annual'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"user_id" uuid,
	"email" "citext" NOT NULL,
	"attempt_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_codes_purpose_check" CHECK ("login_codes"."purpose" in ('login', 'email_change')),
	CONSTRAINT "login_codes_user_id_check" CHECK ("login_codes"."purpose" = 'login' or "login_codes"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"entered_association_id" uuid,
	"entered_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_hash_unique" UNIQUE("session_hash")
);
--> statement-breakpoint
CREATE TABLE "association_admin_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "association_admin_invitations_status_check" CHECK ("association_admin_invitations"."status" in ('pending', 'accepted', 'rejected', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "association_admins" (
	"association_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	"mfa_enroll_by" timestamp with time zone,
	CONSTRAINT "association_admins_association_id_user_id_pk" PRIMARY KEY("association_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "association_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"association_id" uuid NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"enroll_code_hash" text,
	"enroll_code_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"association_id" uuid,
	"action" text NOT NULL,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"cascaded_count" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"deleted_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid,
	"mail_type" text NOT NULL,
	"to_email" text NOT NULL,
	"user_id" uuid,
	"entry_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_logs_status_check" CHECK ("mail_logs"."status" in ('queued', 'sent', 'failed', 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "category_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label_default" text NOT NULL,
	"gender" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" integer,
	"court_size" integer DEFAULT 4 NOT NULL,
	"mixed_min_male" integer DEFAULT 1 NOT NULL,
	"mixed_min_female" integer DEFAULT 2 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "category_presets_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "category_presets_gender_check" CHECK ("category_presets"."gender" in ('male', 'female', 'mixed')),
	CONSTRAINT "category_presets_rule_type_check" CHECK ("category_presets"."rule_type" in ('free', 'min_age', 'total_age')),
	CONSTRAINT "category_presets_court_size_check" CHECK ("category_presets"."court_size" >= 1),
	CONSTRAINT "category_presets_mixed_min_check" CHECK ("category_presets"."gender" <> 'mixed' or "category_presets"."mixed_min_male" + "category_presets"."mixed_min_female" <= "category_presets"."court_size"),
	CONSTRAINT "category_presets_rule_value_check" CHECK (("category_presets"."rule_type" = 'free') = ("category_presets"."rule_value" is null))
);
--> statement-breakpoint
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_entered_association_id_associations_id_fk" FOREIGN KEY ("entered_association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_admin_invitations" ADD CONSTRAINT "association_admin_invitations_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_admin_invitations" ADD CONSTRAINT "association_admin_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_admins" ADD CONSTRAINT "association_admins_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_admins" ADD CONSTRAINT "association_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_admins" ADD CONSTRAINT "association_admins_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "association_slug_history" ADD CONSTRAINT "association_slug_history_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_access_logs" ADD CONSTRAINT "admin_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_access_logs" ADD CONSTRAINT "admin_access_logs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_logs" ADD CONSTRAINT "deletion_logs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_logs" ADD CONSTRAINT "deletion_logs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_logs" ADD CONSTRAINT "mail_logs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_logs" ADD CONSTRAINT "mail_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_presets" ADD CONSTRAINT "category_presets_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_presets" ADD CONSTRAINT "category_presets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uk" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "login_codes_attempt_idx" ON "login_codes" USING btree ("attempt_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "association_admin_invitations_pending_uk" ON "association_admin_invitations" USING btree ("association_id","email") WHERE "association_admin_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "admin_access_logs_idx" ON "admin_access_logs" USING btree ("association_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mail_logs_queue_idx" ON "mail_logs" USING btree ("next_attempt_at") WHERE "mail_logs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "mail_logs_daily_idx" ON "mail_logs" USING btree ("sent_at") WHERE "mail_logs"."status" = 'sent';--> statement-breakpoint
CREATE UNIQUE INDEX "category_presets_code_uk" ON "category_presets" USING btree ("association_id","code") WHERE "category_presets"."deleted_at" is null;