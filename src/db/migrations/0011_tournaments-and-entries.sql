CREATE TABLE "export_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"user_id" uuid,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"format" text NOT NULL,
	"year" integer,
	"includes_birth_date" boolean DEFAULT false NOT NULL,
	"row_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"preset_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"entry_end_at" timestamp with time zone,
	"age_reference_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"max_entries" integer,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "tournament_categories_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "tournament_categories_max_entries_check" CHECK ("tournament_categories"."max_entries" is null or "tournament_categories"."max_entries" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_date" date,
	"age_reference_date" date NOT NULL,
	"venue" text,
	"description" text,
	"entry_start_at" timestamp with time zone,
	"entry_end_at" timestamp with time zone NOT NULL,
	"team_size_min" integer DEFAULT 4 NOT NULL,
	"team_size_max" integer DEFAULT 7 NOT NULL,
	"max_entries" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "tournaments_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "tournaments_status_check" CHECK ("tournaments"."status" in ('draft', 'open', 'closed', 'archived')),
	CONSTRAINT "tournaments_max_entries_check" CHECK ("tournaments"."max_entries" is null or "tournaments"."max_entries" > 0),
	CONSTRAINT "tournaments_team_size_check" CHECK ("tournaments"."team_size_min" >= 1 and "tournaments"."team_size_min" <= "tournaments"."team_size_max"),
	CONSTRAINT "tournaments_entry_period_check" CHECK ("tournaments"."entry_start_at" is null or "tournaments"."entry_start_at" < "tournaments"."entry_end_at")
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"team_name" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"needs_admin_check" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "entries_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "entries_status_check" CHECK ("entries"."status" in ('submitted', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "entry_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_audits_action_check" CHECK ("entry_audits"."action" in ('create', 'update', 'cancel', 'recalc_age', 'admin_checked'))
);
--> statement-breakpoint
CREATE TABLE "entry_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"kana" text,
	"birth_date" date,
	"sex" text NOT NULL,
	"age_at_event" integer,
	"name_normalized" text NOT NULL,
	"kana_normalized" text,
	"member_id" uuid,
	"match_type" text,
	CONSTRAINT "entry_players_entry_id_position_unique" UNIQUE("entry_id","position"),
	CONSTRAINT "entry_players_sex_check" CHECK ("entry_players"."sex" in ('male', 'female')),
	CONSTRAINT "entry_players_match_type_check" CHECK ("entry_players"."match_type" in ('picked', 'auto_exact', 'auto_new', 'unmatched'))
);
--> statement-breakpoint
CREATE TABLE "membership_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_declarations_association_id_team_id_year_unique" UNIQUE("association_id","team_id","year")
);
--> statement-breakpoint
CREATE TABLE "membership_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	CONSTRAINT "membership_periods_association_id_year_unique" UNIQUE("association_id","year"),
	CONSTRAINT "membership_periods_period_check" CHECK ("membership_periods"."opens_at" < "membership_periods"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"team_id" uuid,
	"year" integer NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'renewal' NOT NULL,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('applied', 'approved', 'declined', 'expired')),
	CONSTRAINT "memberships_source_check" CHECK ("memberships"."source" in ('renewal', 'additional', 'import'))
);
--> statement-breakpoint
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_tournament_fk" FOREIGN KEY ("association_id","tournament_id") REFERENCES "public"."tournaments"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_categories" ADD CONSTRAINT "tournament_categories_preset_fk" FOREIGN KEY ("association_id","preset_id") REFERENCES "public"."category_presets"("association_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_tournament_fk" FOREIGN KEY ("association_id","tournament_id") REFERENCES "public"."tournaments"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_category_fk" FOREIGN KEY ("association_id","category_id") REFERENCES "public"."tournament_categories"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_audits" ADD CONSTRAINT "entry_audits_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_audits" ADD CONSTRAINT "entry_audits_entry_fk" FOREIGN KEY ("association_id","entry_id") REFERENCES "public"."entries"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_players" ADD CONSTRAINT "entry_players_entry_fk" FOREIGN KEY ("association_id","entry_id") REFERENCES "public"."entries"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 手で直した: 人物を物理削除しても申込の行は残し、member_id だけ NULL にする（列を指定した SET NULL・PostgreSQL 15 以降。§5.16・ADR 0019）
ALTER TABLE "entry_players" ADD CONSTRAINT "entry_players_member_fk" FOREIGN KEY ("association_id","member_id") REFERENCES "public"."members"("association_id","id") ON DELETE SET NULL ("member_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_declarations" ADD CONSTRAINT "membership_declarations_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_declarations" ADD CONSTRAINT "membership_declarations_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_fk" FOREIGN KEY ("association_id","member_id") REFERENCES "public"."members"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 手で直した: チームを物理削除しても資格は残し、team_id だけ NULL にする（ADR 0019）
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE SET NULL ("team_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_categories_code_uk" ON "tournament_categories" USING btree ("tournament_id","code") WHERE "tournament_categories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_tournament_idx" ON "entries" USING btree ("tournament_id","status") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "entries_created_by_idx" ON "entries" USING btree ("created_by","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entries_team_idx" ON "entries" USING btree ("team_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entry_audits_entry_idx" ON "entry_audits" USING btree ("entry_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_member_year_uk" ON "memberships" USING btree ("association_id","member_id","year") WHERE "memberships"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_year_idx" ON "memberships" USING btree ("association_id","year","status");--> statement-breakpoint
ALTER TABLE "mail_logs" ADD CONSTRAINT "mail_logs_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 手で直した: 申込を物理削除しても問い合わせは残し、entry_id だけ NULL にする（§5.10・ADR 0019）
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_entry_fk" FOREIGN KEY ("association_id","entry_id") REFERENCES "public"."entries"("association_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;