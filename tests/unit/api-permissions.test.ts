import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, ROLES, can, roleIncludes } from "@/lib/authz";
import { API_PERMISSIONS, GUARD_TOKENS, type HttpMethod } from "@/lib/api/permissions";

// API の権限表（設計書 §3.2・§12.1「権限表のテスト」）。表と src/app/api/ の実物が食い違っていないことを確かめる
// ロールごとの可否そのものは ACTIONS（src/lib/authz.ts）が唯一のデータ。ここは URL との対応と、入口の検査の有無を見る
const API_DIR = join(process.cwd(), "src/app/api");
const METHODS: readonly HttpMethod[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

function routeFiles(dir: string, prefix = ""): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...routeFiles(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name));
    } else if (entry.name === "route.ts") {
      found.push({ path: prefix, source: readFileSync(join(dir, entry.name), "utf8") });
    }
  }
  return found;
}

const routes = routeFiles(API_DIR).sort((a, b) => a.path.localeCompare(b.path));

function declaredMethods(source: string): HttpMethod[] {
  return METHODS.filter((m) => new RegExp(`export async function ${m}\\b`).test(source));
}

function permissionsFor(path: string) {
  return API_PERMISSIONS.filter((p) => p.path === path);
}

describe("API の権限表（§3.2 と URL の対応）", () => {
  it("src/app/api/ のすべての route.ts が表にある", () => {
    const missing = routes.filter((r) => permissionsFor(r.path).length === 0).map((r) => r.path);
    expect(missing).toEqual([]);
    const extra = API_PERMISSIONS.filter((p) => !routes.some((r) => r.path === p.path)).map((p) => p.path);
    expect(extra).toEqual([]);
  });

  it.each(routes.map((r) => r.path))("%s: 実装しているメソッドと表が一致する", (path) => {
    const route = routes.find((r) => r.path === path);
    if (!route) throw new Error(`route が見つかりません: ${path}`);
    const declared = declaredMethods(route.source);
    const listed = permissionsFor(path).flatMap((p) => p.methods);
    expect([...listed].sort()).toEqual([...declared].sort());
    // 同じメソッドを 2 行に書かない
    expect(new Set(listed).size).toBe(listed.length);
  });

  it.each(routes.map((r) => r.path))("%s: 表のとおりの入口で認可を検査している", (path) => {
    const route = routes.find((r) => r.path === path);
    if (!route) throw new Error(`route が見つかりません: ${path}`);
    for (const permission of permissionsFor(path)) {
      const tokens = GUARD_TOKENS[permission.guard.kind];
      if (tokens.length === 0) continue;
      expect(tokens.some((token) => route.source.includes(token))).toBe(true);
    }
  });

  it("URL に氏名・メールアドレスを載せない（動的な部分は ID かスラッグだけ・§10）", () => {
    // リクエストログに残るため、検索語も含めて POST の本文で送る（受け入れ条件）
    const allowed = new Set(["[slug]", "[teamId]", "[teamMemberId]", "[memberId]", "[tournamentId]", "[categoryId]", "[presetId]", "[entryId]", "[documentId]", "[invitationId]", "[userId]", "[id]", "[table]"]);
    const dynamic = API_PERMISSIONS.flatMap((p) => p.path.split("/")).filter((segment) => segment.startsWith("["));
    expect([...new Set(dynamic)].filter((segment) => !allowed.has(segment))).toEqual([]);
  });

  it("運営管理者だけの API は、表でも運営管理者の行になっている（§3.2 の下 2 行）", () => {
    for (const permission of API_PERMISSIONS) {
      if (permission.guard.kind !== "platform") continue;
      expect(can("association_admin", permission.guard.action)).toBe(false);
      expect(can("platform_admin", permission.guard.action)).toBe(true);
    }
  });

  it("誰でも見られる API は、§3.2 でもアンノウンができる行になっている（§5.6）", () => {
    for (const permission of API_PERMISSIONS) {
      if (permission.guard.kind !== "publicTenant") continue;
      expect(can("anonymous", permission.guard.action)).toBe(true);
    }
  });

  it("協会の中の API は、表の行のとおりに最も低いロールが決まっている", () => {
    for (const permission of API_PERMISSIONS) {
      if (permission.guard.kind !== "tenant") continue;
      const rule = ACTIONS[permission.guard.action];
      // アンノウンはどの行もできない（requireTenantUser が未ログインを 403 で返す）
      expect(can("anonymous", permission.guard.action)).toBe(false);
      for (const role of ROLES) {
        expect(can(role, permission.guard.action)).toBe(roleIncludes(role, rule.minRole));
      }
    }
  });
});
