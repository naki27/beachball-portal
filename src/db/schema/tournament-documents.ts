import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tournaments } from "./tournaments";
import { users } from "./users";

export type DocumentType = "大会冊子" | "要項" | "組み合わせ" | "結果" | "その他";

// 大会資料（§5.9・付録 A tournament_documents）。PDF だけ。保管用（原本）と公開用の 2 つの置き場を持つ
//   storage_key … 保管用バケットのキー（非公開。消さない限り残る）
//   public_key  … 公開用バケットのキー。**公開中だけ入る**。推測されにくいランダムな名前で、差し替えたら新しい名前になる
export const tournamentDocuments = pgTable(
  "tournament_documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    tournamentId: uuid().notNull(),
    docType: text().$type<DocumentType>().notNull(),
    title: text().notNull(),
    storageKey: text().notNull(),
    publicKey: text(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    isPublic: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    uploadedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    unique("tournament_documents_association_id_id_unique").on(t.associationId, t.id),
    check("tournament_documents_doc_type_check", sql`${t.docType} in ('大会冊子', '要項', '組み合わせ', '結果', 'その他')`),
    check("tournament_documents_content_type_check", sql`${t.contentType} = 'application/pdf'`),
    check("tournament_documents_size_check", sql`${t.sizeBytes} > 0`),
    foreignKey({
      name: "tournament_documents_tournament_fk",
      columns: [t.associationId, t.tournamentId],
      foreignColumns: [tournaments.associationId, tournaments.id],
    }).onDelete("cascade"),
    index("tournament_documents_tournament_idx").on(t.associationId, t.tournamentId, t.sortOrder),
  ],
);
