import type { FullConfig } from "@playwright/test";

// dev サーバー（webpack + polling）は、初めて開くページをその場でコンパイルする。テストの途中でコンパイルが走ると、
// クライアント側の画面遷移が途中の応答を受けて error 境界に落ちることがある（開発時だけの揺らぎ）。
// そこで、テストが使うページを先に一度ずつ取得して温めておく（状態コードは問わない）
const PATHS = [
  "/",
  "/sawara",
  "/sawara/admin",
  "/nothing",
  "/login",
  "/login?next=%2Fsawara",
  "/login/code",
  "/login/help",
  "/dev/ui",
  "/robots.txt",
];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3000";
  for (const path of PATHS) {
    try {
      await fetch(new URL(path, baseURL), { redirect: "manual" });
    } catch {
      // サーバーがまだ起きていない場合は webServer の起動待ちに任せる
    }
  }
}
