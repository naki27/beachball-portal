import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tournaments } from "./tournaments";
import { users } from "./users";

export type DocumentType = "大会冊子" | "要項" | "組み合わせ" | "結果" | "その他";

// 大会資料（§5.9・付録 A）。原本は保管用（非公開）のバケットに置き、公開中の資料だけ公開用にコピーする（public_key・C-02）
// 形式は PDF だけ。中身（選手名が載った組み合わせ表など）は協会の判断で公開されるので、システムでは検査しない
export const tournamentDocuments = pgTable(
  "tournament_documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    tournamentId: uuid().notNull(),
    docType: text().$type<DocumentType>().notNull(),
    title: text().notNull(),
    storageKey: text().notNull(), // 保管用バケット（非公開）のキー
    publicKey: text(), // 公開用バケットのキー。公開中だけ入る。推測されにくいランダムな名前（§5.9）
    contentType: text().notNull(), // PDF のみ（§5.9）
    sizeBytes: integer().notNull(),
    isPublic: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    uploadedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    check("tournament_documents_doc_type_check", sql`${t.docType} in ('大会冊子', '要項', '組み合わせ', '結果', 'その他')`),
    check("tournament_documents_content_type_check", sql`${t.contentType} = 'application/pdf'`),
    foreignKey({
      name: "tournament_documents_tournament_fk",
      columns: [t.associationId, t.tournamentId],
      foreignColumns: [tournaments.associationId, tournaments.id],
    }).onDelete("cascade"),
  ],
);
