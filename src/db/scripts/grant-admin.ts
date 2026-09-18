// pnpm dev:grant-admin <メールアドレス> <協会のスラッグ> — 開発用。そのアドレスをテナント管理者にする（本番では使わない）
// アカウントがなければ users を作る（確認済みにする）。association_admins にすでにあれば何もしない
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, createDb } from "../client";
import { loadEnv, requireEnv } from "../env";
import { associationAdmins, associations, users } from "../schema";
import { withTenantOn } from "../tenant";

async function main(): Promise<void> {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("本番では使いません");
  const [email, slug] = process.argv.slice(2);
  if (!email?.includes("@") || !slug) throw new Error("使い方: pnpm dev:grant-admin <メールアドレス> <協会のスラッグ>");

  const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  try {
    const [association] = await db.select().from(associations).where(eq(associations.slug, slug)).limit(1);
    if (!association) throw new Error(`協会がありません: ${slug}`);

    const normalized = email.trim().toLowerCase();
    const [found] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalized), isNull(users.deletedAt)))
      .limit(1);
    const userId =
      found?.id ??
      (await db.insert(users).values({ email: normalized, emailVerifiedAt: new Date() }).returning({ id: users.id }))[0].id;

    const inserted = await withTenantOn(db, association.id, (tx) =>
      tx
        .insert(associationAdmins)
        .values({ associationId: association.id, userId })
        .onConflictDoNothing()
        .returning({ userId: associationAdmins.userId }),
    );
    console.log(
      `${association.name}（${slug}）の管理者: ${inserted.length > 0 ? "追加しました" : "すでに管理者です"}（アカウント ${found ? "あり" : "を作成"}）`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
