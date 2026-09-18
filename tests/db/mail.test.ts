import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { mailLogs } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { enqueueMail } from "@/lib/mail/outbox";
import { MAX_ATTEMPTS, nextAttemptAfter, processMailQueue, sanitizeError } from "@/lib/mail/queue";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";
import { SITE_NAME } from "@/lib/site";

// 送信待ちの表と送信ジョブ（設計書 §11「送り方」）。積むのはアプリ（app_user）、送るのはジョブ（app_job）
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
const TO = `mail-test-${Math.random().toString(36).slice(2, 8)}@example.com`;

afterAll(async () => {
  await job.delete(mailLogs).where(eq(mailLogs.toEmail, TO));
  await closeDb(app);
  await closeDb(job);
});

function recordingSender(): MailSender & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
      return { providerMessageId: `fake-${sent.length}` };
    },
  };
}

const failingSender: MailSender = {
  async send(mail) {
    throw new Error(`connection refused while sending to ${mail.to}`);
  },
};

async function row(id: string) {
  const [r] = await job.select().from(mailLogs).where(eq(mailLogs.id, id));
  return r;
}

describe("送信待ちの表と送信ジョブ", () => {
  it("積んだメールがジョブで sent になる。本文は送る直前に組み立て、件名は【協会名】", async () => {
    const id = await app.transaction((tx) =>
      enqueueMail(tx, { associationId: SAWARA_ASSOCIATION_ID, mailType: "test", toEmail: TO, params: { note: "abc" } }),
    );
    expect((await row(id)).status).toBe("queued");

    const sender = recordingSender();
    const result = await processMailQueue(job, sender);
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const after = await row(id);
    expect(after.status).toBe("sent");
    expect(after.sentAt).not.toBeNull();
    expect(after.attempts).toBe(1);
    expect(after.providerMessageId).toMatch(/^fake-/);

    const mail = sender.sent.find((m) => m.to === TO);
    expect(mail?.subject).toBe("【早良区協会】テスト送信");
    expect(mail?.text).toContain("メモ: abc");
  });

  it("協会に属さないメールは件名が【サイト名】", async () => {
    const id = await app.transaction((tx) =>
      enqueueMail(tx, { associationId: null, mailType: "test", toEmail: TO }),
    );
    const sender = recordingSender();
    await processMailQueue(job, sender);
    expect((await row(id)).status).toBe("sent");
    expect(sender.sent.find((m) => m.to === TO)?.subject).toBe(`【${SITE_NAME}】テスト送信`);
  });

  it("送信に失敗すると attempts が増え、間隔を延ばして再試行。5 回で failed。記録に宛先は残らない", async () => {
    const id = await app.transaction((tx) =>
      enqueueMail(tx, { associationId: SAWARA_ASSOCIATION_ID, mailType: "test", toEmail: TO }),
    );
    let now = new Date();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await processMailQueue(job, failingSender, { now });
      const r = await row(id);
      expect(r.attempts).toBe(attempt);
      expect(r.error).toContain("connection refused");
      expect(r.error).not.toContain(TO);
      if (attempt < MAX_ATTEMPTS) {
        expect(r.status).toBe("queued");
        expect(r.nextAttemptAt.getTime()).toBe(nextAttemptAfter(attempt, now).getTime());
        // まだ時刻が来ていないので、もう一度流しても触られない
        await processMailQueue(job, failingSender, { now });
        expect((await row(id)).attempts).toBe(attempt);
        now = new Date(r.nextAttemptAt.getTime() + 1000);
      } else {
        expect(r.status).toBe("failed");
      }
    }
  });

  it("雛形のない種別は再試行せずに failed", async () => {
    const id = await app.transaction((tx) =>
      enqueueMail(tx, { associationId: SAWARA_ASSOCIATION_ID, mailType: "entry_completed", toEmail: TO }),
    );
    const sender = recordingSender();
    await processMailQueue(job, sender);
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("template missing");
    expect(sender.sent.find((m) => m.to === TO)).toBeUndefined();
  });

  it("再試行の間隔は 1・5・15・60・180 分", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    expect(nextAttemptAfter(1, now).toISOString()).toBe("2026-04-01T00:01:00.000Z");
    expect(nextAttemptAfter(2, now).toISOString()).toBe("2026-04-01T00:05:00.000Z");
    expect(nextAttemptAfter(5, now).toISOString()).toBe("2026-04-01T03:00:00.000Z");
    expect(sanitizeError(new Error("to a@b.jp and <c@d.jp>"))).toBe("Error: to <email> and <<email>>");
  });
});
