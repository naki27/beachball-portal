import type { FullConfig } from "@playwright/test";
import { eq, inArray, like, or } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv } from "../../src/db/env";
import {
  adminAccessLogs,
  associationAdminInvitations,
  associationAdmins,
  associations,
  associationSlugHistory,
  categoryPresets,
  mailLogs,
  members,
  platformAdmins,
  rateLimits,
  sessions,
  teamAdmins,
  teams,
  users,
} from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";

// 1. dev サーバー（webpack + polling）は、初めて開くページをその場でコンパイルする。テストの途中でコンパイルが走ると、
//    クライアント側の画面遷移が途中の応答を受けて error 境界に落ちることがある（開発時だけの揺らぎ）。
//    そこで、テストが使うページを先に一度ずつ取得して温めておく（状態コードは問わない）
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
  "/platform",
  "/platform/associations/00000000-0000-4000-8000-000000000000",
  "/invitations",
  "/mypage",
  "/sawara/teams/new",
  "/sawara/teams/new?kind=individual",
  // チームのページ（動的な URL）。ない ID なので 404 になるだけ
  "/sawara/teams/00000000-0000-4000-8000-000000000000",
  "/sawara/teams/00000000-0000-4000-8000-000000000000/edit",
  "/sawara/teams/00000000-0000-4000-8000-000000000000/members",
  "/sawara/teams/00000000-0000-4000-8000-000000000000/members/new",
  "/sawara/teams/00000000-0000-4000-8000-000000000000/members/new?self=1",
  "/sawara/teams/00000000-0000-4000-8000-000000000000/members/00000000-0000-4000-8000-000000000000/edit",
  "/robots.txt",
];

// 2. ログインのレート制限（IP 単位 20 回/時など）は、E2E を繰り返すと同じ IP で上限に達する。
//    テストの前にログイン系の数えた行を消す（テスト用の DB だけ。本番の DB に向けない）
// 3. タイムアウトで止まった E2E は後片付け（finally）まで進まない。e2e-… のアカウントとその役割・招待を消しておく
//    （残ると、早良区協会の管理者と招待の「5 名まで」に当たる）
async function resetTestState(): Promise<void> {
  loadEnv();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) return;
  const db = createDb(url, { max: 1 });
  try {
    await db.delete(rateLimits).where(or(like(rateLimits.key, "login_request:%"), like(rateLimits.key, "login_verify:%")));

    // E2E が作った協会（スラッグ e2e-…）ごと消す
    const e2eAssociations = await db.select({ id: associations.id }).from(associations).where(like(associations.slug, "e2e-%"));
    for (const { id } of e2eAssociations) {
      await withTenantOn(db, id, async (tx) => {
        await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, id));
        await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.associationId, id));
        await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, id));
        await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.associationId, id));
        await tx.delete(teams).where(eq(teams.associationId, id)); // 代表者・名簿の行は cascade で消える
      });
      await db.update(sessions).set({ enteredAssociationId: null, enteredUntil: null }).where(eq(sessions.enteredAssociationId, id));
      await db.delete(adminAccessLogs).where(eq(adminAccessLogs.associationId, id));
      await db.delete(mailLogs).where(eq(mailLogs.associationId, id));
      await db.delete(associations).where(eq(associations.id, id));
    }

    const leftovers = await db.select({ id: users.id }).from(users).where(like(users.email, "e2e-%@example.com"));
    const ids = leftovers.map((u) => u.id);
    await withTenantOn(db, SAWARA_ASSOCIATION_ID, async (tx) => {
      if (ids.length > 0) {
        await tx.delete(associationAdmins).where(inArray(associationAdmins.userId, ids));
        await tx.delete(teamAdmins).where(inArray(teamAdmins.userId, ids));
        await tx.delete(teams).where(inArray(teams.createdBy, ids)); // 選手一覧の行は cascade で消える
      }
      // E2E が名簿に入れた人物（氏名が E2E… で始まる。正規化後は小文字）
      await tx.delete(members).where(like(members.nameNormalized, "e2e%"));
      await tx.delete(associationAdminInvitations).where(like(associationAdminInvitations.email, "e2e-%@example.com"));
    });
    await db.delete(mailLogs).where(like(mailLogs.toEmail, "e2e-%@example.com"));
    if (ids.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, ids));
      await db.delete(adminAccessLogs).where(inArray(adminAccessLogs.userId, ids));
      await db.delete(platformAdmins).where(inArray(platformAdmins.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  } finally {
    await closeDb(db);
  }
}

// API も初回はコンパイルに数秒かかるので、空の POST で先にコンパイルさせる（Origin の検査で 403 になるだけ）
// 動的な URL はない ID で（Origin の検査か 405 で止まる）
const NO_ID = "00000000-0000-4000-8000-000000000000";
const API_PATHS = [
  "/api/auth/request",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/me",
  "/api/me/invitations",
  `/api/me/invitations/${NO_ID}/accept`,
  "/api/platform/associations",
  `/api/platform/associations/${NO_ID}`,
  `/api/platform/associations/${NO_ID}/enter`,
  `/api/platform/associations/${NO_ID}/admin-invitations`,
  "/api/sawara/teams",
  `/api/sawara/teams/${NO_ID}`,
  `/api/sawara/teams/${NO_ID}/members`,
  `/api/sawara/teams/${NO_ID}/members/${NO_ID}`,
  `/api/sawara/teams/${NO_ID}/members/${NO_ID}/leave`,
  `/api/sawara/teams/${NO_ID}/members/${NO_ID}/undo-leave`,
  `/api/sawara/teams/${NO_ID}/invitations`,
  `/api/sawara/teams/${NO_ID}/invitations/${NO_ID}`,
  `/api/sawara/teams/${NO_ID}/invitations/${NO_ID}/resend`,
  `/api/sawara/members/${NO_ID}/link`,
  `/api/me/invitations/${NO_ID}/reject`,
];

export default async function globalSetup(config: FullConfig): Promise<void> {
  await resetTestState();
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3000";
  for (const path of PATHS) {
    try {
      await fetch(new URL(path, baseURL), { redirect: "manual" });
    } catch {
      // サーバーがまだ起きていない場合は webServer の起動待ちに任せる
    }
  }
  for (const path of API_PATHS) {
    try {
      await fetch(new URL(path, baseURL), { method: "POST" });
    } catch {
      // 同上
    }
  }
}
