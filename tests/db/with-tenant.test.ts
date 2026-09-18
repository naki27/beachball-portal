import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { withTenant, type Tx } from "@/db/tenant";

// Postgres（.env の DATABASE_URL）が要る。vitest.config.mts でプールを 1 接続にしているので、
// 「外」の問い合わせは直前の withTenant と同じ接続で走る（設定が漏れていないことを確かめられる）

const ASSOCIATION_A = "11111111-1111-4111-8111-111111111111";
const ASSOCIATION_B = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

type Settings = { associationId: string | null; userId: string | null; pid: number };

// current_setting(name, true) は一度も設定していなければ NULL、トランザクションが終わったあとは '' になる。
// どちらも「入っていない」として扱う（RLS のポリシーも A-03 で同じ扱いにする）
async function readSettings(runner: Pick<Tx, "execute">): Promise<Settings> {
  const result = await runner.execute<{ association_id: string | null; user_id: string | null; pid: number }>(sql`
    select nullif(current_setting('app.association_id', true), '') as association_id,
           nullif(current_setting('app.user_id', true), '') as user_id,
           pg_backend_pid() as pid
  `);
  const row = result.rows[0];
  return { associationId: row.association_id, userId: row.user_id, pid: row.pid };
}

describe("withTenant", () => {
  afterAll(() => closeDb());

  it("中では app.association_id が入り、外では入っていない", async () => {
    const inside = await withTenant(ASSOCIATION_A, readSettings);
    const outside = await readSettings(getDb());

    expect(inside.associationId).toBe(ASSOCIATION_A);
    expect(outside.pid).toBe(inside.pid);
    expect(outside.associationId).toBeNull();
  });

  it("別の協会を渡すと別の値になる", async () => {
    const a = await withTenant(ASSOCIATION_A, readSettings);
    const b = await withTenant(ASSOCIATION_B, readSettings);
    expect(a.associationId).toBe(ASSOCIATION_A);
    expect(b.associationId).toBe(ASSOCIATION_B);
  });

  it("userId は渡したときだけ app.user_id に入る", async () => {
    const anonymous = await withTenant(ASSOCIATION_A, readSettings);
    const loggedIn = await withTenant(ASSOCIATION_A, readSettings, { userId: USER_ID });
    const after = await readSettings(getDb());

    expect(anonymous.userId).toBeNull();
    expect(loggedIn.userId).toBe(USER_ID);
    expect(after.userId).toBeNull();
  });

  it("associationId が空なら DB に触らずに止まる", async () => {
    await expect(withTenant("", readSettings)).rejects.toThrow("associationId");
  });
});
