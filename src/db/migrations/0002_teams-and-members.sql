CREATE TABLE "member_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name_normalized" text NOT NULL,
	"kana_normalized" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_aliases_member_id_name_normalized_kana_normalized_unique" UNIQUE("member_id","name_normalized","kana_normalized")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kana" text,
	"birth_date" date NOT NULL,
	"sex" text NOT NULL,
	"name_normalized" text NOT NULL,
	"kana_normalized" text,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"last_entry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "members_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "members_sex_check" CHECK ("members"."sex" in ('male', 'female')),
	CONSTRAINT "members_status_check" CHECK ("members"."status" in ('active', 'needs_review', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "team_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid,
	"email" "citext" NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invitations_kind_check" CHECK ("team_invitations"."kind" in ('player', 'admin')),
	CONSTRAINT "team_invitations_status_check" CHECK ("team_invitations"."status" in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "team_invitations_member_id_check" CHECK ("team_invitations"."kind" = 'admin' or "team_invitations"."member_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"left_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"kind" text DEFAULT 'team' NOT NULL,
	"name" text NOT NULL,
	"kana" text,
	"contact_email" text,
	"contact_phone" text,
	"membership_renewal_target" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "teams_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "teams_kind_check" CHECK ("teams"."kind" in ('team', 'individual')),
	CONSTRAINT "teams_status_check" CHECK ("teams"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "member_aliases" ADD CONSTRAINT "member_aliases_member_fk" FOREIGN KEY ("association_id","member_id") REFERENCES "public"."members"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_merged_into_id_members_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_member_fk" FOREIGN KEY ("association_id","member_id") REFERENCES "public"."members"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_left_by_users_id_fk" FOREIGN KEY ("left_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_fk" FOREIGN KEY ("association_id","team_id") REFERENCES "public"."teams"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_member_fk" FOREIGN KEY ("association_id","member_id") REFERENCES "public"."members"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_user_uk" ON "members" USING btree ("association_id","user_id") WHERE "members"."user_id" is not null and "members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "members_name_norm_trgm" ON "members" USING gin ("name_normalized" gin_trgm_ops) WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "members_kana_norm_trgm" ON "members" USING gin ("kana_normalized" gin_trgm_ops) WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "members_name_birth_idx" ON "members" USING btree ("association_id","name_normalized","birth_date") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_admins_active_uk" ON "team_admins" USING btree ("team_id","user_id") WHERE "team_admins"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "team_admins_user_idx" ON "team_admins" USING btree ("user_id") WHERE "team_admins"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "team_invitations_email_idx" ON "team_invitations" USING btree ("email") WHERE "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_player_pending_uk" ON "team_invitations" USING btree ("association_id","member_id") WHERE "team_invitations"."kind" = 'player' and "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_admin_pending_uk" ON "team_invitations" USING btree ("team_id","email") WHERE "team_invitations"."kind" = 'admin' and "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_members_team_idx" ON "team_members" USING btree ("team_id","left_at") WHERE "team_members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "team_members_member_idx" ON "team_members" USING btree ("member_id") WHERE "team_members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_active_uk" ON "team_members" USING btree ("team_id","member_id") WHERE "team_members"."left_at" is null and "team_members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_individual_uk" ON "teams" USING btree ("association_id","created_by") WHERE "teams"."kind" = 'individual' and "teams"."deleted_at" is null;