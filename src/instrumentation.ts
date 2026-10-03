// Next.js のサーバーが起きるときに 1 回だけ動く（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md）
// 本番で必須の環境変数が足りなければ、名前だけを出して起動を止める（X-01・設計書 §6.3）
// Edge ランタイムでも呼ばれるので、Node のときだけ検査する

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnv } = await import("@/lib/env/production");
  try {
    assertProductionEnv("app");
  } catch (error) {
    // 投げただけでは Next.js が受け止めて起き続けることがあるので、ここで確実に落とす
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
