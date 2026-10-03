import { describe, expect, it } from "vitest";
import { buildBrevoBody, createBrevoSender, type BrevoConfig } from "@/lib/mail/brevo";

// Brevo でのメール送信（設計書 §11.1・§11.2・X-01）。fetch を差し替えて、送る中身とエラーの文言を確かめる

const CONFIG: BrevoConfig = {
  apiKey: "xkeysib-very-secret-key",
  from: "no-reply@mail.fukuoka-city-beachball.org",
  defaultFromName: "ビーチボール大会申し込みサイト",
};

const MAIL = { to: "daihyou@example.org", subject: "【早良区協会】申込を受け付けました", text: "本文" };

type Call = { url: string; init: RequestInit };

function stubFetch(response: Response): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } });

describe("送る中身", () => {
  it("差出人は MAIL_FROM、表示名は渡された協会名、返信先は協会の連絡先", () => {
    const body = buildBrevoBody(CONFIG, { ...MAIL, fromName: "早良区ビーチボール協会", replyTo: "sawara@example.org" });
    expect(body.sender).toEqual({ email: CONFIG.from, name: "早良区ビーチボール協会" });
    expect(body.replyTo).toEqual({ email: "sawara@example.org" });
    expect(body.subject).toBe(MAIL.subject);
    expect(body.textContent).toBe("本文");
  });

  it("表示名が渡されなければサイト名。返信先がなければ入れない", () => {
    const body = buildBrevoBody(CONFIG, MAIL);
    expect(body.sender.name).toBe(CONFIG.defaultFromName);
    expect(body.replyTo).toBeUndefined();
  });

  it("表示名は 70 文字で切る（Brevo の上限）", () => {
    const body = buildBrevoBody(CONFIG, { ...MAIL, fromName: "あ".repeat(80) });
    expect(body.sender.name).toHaveLength(70);
  });

  it("開封・クリックの記録を匿名化して送る（§11.2）", () => {
    expect(buildBrevoBody(CONFIG, MAIL).to).toEqual([{ email: MAIL.to, contactPixelTrackingConsent: false }]);
  });
});

describe("送信", () => {
  it("API キーをヘッダに付け、打ち切りの合図を付けて POST する", async () => {
    const { fetchImpl, calls } = stubFetch(ok({ messageId: "<abc@brevo>" }));
    const result = await createBrevoSender(CONFIG, fetchImpl).send(MAIL);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "api-key": CONFIG.apiKey, "content-type": "application/json" });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ providerMessageId: "<abc@brevo>" });
  });

  it("messageId が返らなくても成功として扱う", async () => {
    const { fetchImpl } = stubFetch(ok({}));
    expect(await createBrevoSender(CONFIG, fetchImpl).send(MAIL)).toEqual({});
  });

  it("断られたら状態と記号だけを文にする（API キー・宛先・本文を入れない）", async () => {
    const refused = new Response(JSON.stringify({ code: "invalid_parameter", message: `${MAIL.to} is invalid` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const { fetchImpl } = stubFetch(refused);
    const error = await createBrevoSender(CONFIG, fetchImpl)
      .send(MAIL)
      .catch((e: unknown) => e);

    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("400");
    expect(message).toContain("invalid_parameter");
    expect(message).not.toContain(CONFIG.apiKey);
    expect(message).not.toContain(MAIL.to);
    expect(message).not.toContain(MAIL.text);
  });

  it("本文が JSON でなくても状態だけで文にする", async () => {
    const { fetchImpl } = stubFetch(new Response("<html>502</html>", { status: 502 }));
    const error = await createBrevoSender(CONFIG, fetchImpl)
      .send(MAIL)
      .catch((e: unknown) => e);
    expect(error instanceof Error ? error.message : "").toContain("502");
  });
});
