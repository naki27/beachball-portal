// Cookie の名前と属性はここ 1 か所で決める（設計書 §9.2・v0.9.4）
// 本番（APP_BASE_URL が https）だけ __Host- の名前と Secure 属性を付ける。http://localhost では WebKit などが受け付けないため

function isSecureSite(): boolean {
  return (process.env.APP_BASE_URL ?? "").startsWith("https://");
}

export function cookiePrefix(): string {
  return isSecureSite() ? "__Host-" : "";
}

// 確認番号の試行 ID（HttpOnly・15 分）
export function loginAttemptCookieName(): string {
  return `${cookiePrefix()}login_attempt`;
}

// セッション（HttpOnly・10 日。A-09）
export function sessionCookieName(): string {
  return `${cookiePrefix()}session`;
}

export const LOGIN_ATTEMPT_COOKIE_MAX_AGE_SECONDS = 15 * 60;

export type CookieAttributes = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

// __Host- の条件（Secure・Path=/・Domain なし）に合わせる
export function cookieAttributes(maxAgeSeconds: number): CookieAttributes {
  return { httpOnly: true, secure: isSecureSite(), sameSite: "lax", path: "/", maxAge: maxAgeSeconds };
}
