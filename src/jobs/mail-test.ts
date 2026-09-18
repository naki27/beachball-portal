// pnpm mail:test <宛先> — 開発用。テストメールを送信待ちに積む（送るのは pnpm job:mail）。ローカルでは Mailpit に届く
import { closeDb, createDb } from "../db/client";
import { loadEnv, requireEnv } from "../db/env";
import { SAWARA_ASSOCIATION_ID } from "../db/seed";
import { enqueueMail } from "../lib/mail/outbox";

async function main(): Promise<void> {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("本番では使いません");
  const to = process.argv[2];
  if (!to || !to.includes("@")) throw new Error("使い方: pnpm mail:test <宛先のメールアドレス>");

  const db = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    const id = await db.transaction((tx) =>
      enqueueMail(tx, {
        associationId: SAWARA_ASSOCIATION_ID,
        mailType: "test",
        toEmail: to,
        params: { note: "pnpm mail:test から" },
      }),
    );
    console.log(`送信待ちに積みました（id: ${id}）。pnpm job:mail で送ると http://localhost:8025 に届きます`);
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
