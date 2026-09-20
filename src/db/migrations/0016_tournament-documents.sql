-- 大会資料（設計書 §5.9・付録 A tournament_documents）。RLS とロールの権限は 0017
-- entries.submit_token は 0014 で当てているのでここには出さない（スナップショットだけ追いつかせる）

CREATE TABLE "tournament_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"public_key" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "tournament_documents_association_id_id_unique" UNIQUE("association_id","id"),
	CONSTRAINT "tournament_documents_doc_type_check" CHECK ("tournament_documents"."doc_type" in ('大会冊子', '要項', '組み合わせ', '結果', 'その他')),
	CONSTRAINT "tournament_documents_content_type_check" CHECK ("tournament_documents"."content_type" = 'application/pdf'),
	CONSTRAINT "tournament_documents_size_check" CHECK ("tournament_documents"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "tournament_documents" ADD CONSTRAINT "tournament_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_documents" ADD CONSTRAINT "tournament_documents_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_documents" ADD CONSTRAINT "tournament_documents_tournament_fk" FOREIGN KEY ("association_id","tournament_id") REFERENCES "public"."tournaments"("association_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_documents_tournament_idx" ON "tournament_documents" USING btree ("association_id","tournament_id","sort_order");
