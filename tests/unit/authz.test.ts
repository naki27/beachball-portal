import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  type Action,
  ANONYMOUS,
  type AssociationMembership,
  type Principal,
  can,
  checkAccess,
  isPlatformAdmin,
  ROLES,
  type Role,
  resolveRole,
  roleIncludes,
} from "@/lib/authz";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TEAM_X = "33333333-3333-4333-8333-333333333333";
const TEAM_Y = "44444444-4444-4444-8444-444444444444";

const user: Principal = { ...ANONYMOUS, userId: "55555555-5555-4555-8555-555555555555", sessionState: "active" };
const membershipInA: AssociationMembership = {
  associationId: A,
  isAssociationAdmin: false,
  teamAdminOf: new Set([TEAM_X]),
  playerOf: new Set([TEAM_Y]),
};

describe("resolveRole（§3.1 の 2 段の判定と包含）", () => {
  it("未ログインはアンノウン", () => {
    expect(resolveRole(ANONYMOUS, null, { associationId: A })).toBe("anonymous");
  });

  it("ログインしていて役割の行がなければ登録者", () => {
    expect(resolveRole(user, null, { associationId: A })).toBe("registered");
    expect(resolveRole(user, membershipInA, { associationId: A })).toBe("registered");
  });

  it("代表者を務めるチームでは代表者、選手として載っているチームでは選手、ほかのチームでは登録者", () => {
    expect(resolveRole(user, membershipInA, { associationId: A, teamId: TEAM_X })).toBe("team_admin");
    expect(resolveRole(user, membershipInA, { associationId: A, teamId: TEAM_Y })).toBe("player");
    expect(resolveRole(user, membershipInA, { associationId: A, teamId: "other" })).toBe("registered");
  });

  it("協会の役割の行は、その協会でしか効かない", () => {
    expect(resolveRole(user, membershipInA, { associationId: B, teamId: TEAM_X })).toBe("registered");
  });

  it("テナント管理者は全チームで協会の管理者（P0 は役割の行があれば付く）", () => {
    const admin = { ...membershipInA, isAssociationAdmin: true };
    expect(resolveRole(user, admin, { associationId: A })).toBe("association_admin");
    expect(resolveRole(user, admin, { associationId: A, teamId: "other" })).toBe("association_admin");
  });

  it("運営管理者は、切り替えて入った協会の中でだけ協会の管理者と同じ（§5.14）", () => {
    const platform: Principal = { ...user, isPlatformAdmin: true, enteredAssociationId: A };
    expect(resolveRole(platform, null, { associationId: A })).toBe("association_admin");
    expect(resolveRole(platform, null, { associationId: B })).toBe("registered");
    expect(isPlatformAdmin(platform)).toBe(true);
    expect(isPlatformAdmin(user)).toBe(false);
  });

  it("P1: 2 段階目の確認が期限外なら、管理者の権限は付かない（条件を足すだけで済む形）", () => {
    const now = new Date("2026-04-01T00:00:00Z");
    const admin = { ...membershipInA, isAssociationAdmin: true };
    const verifiedRecently: Principal = { ...user, mfaVerifiedAt: new Date("2026-03-31T23:00:00Z") };
    const verifiedLongAgo: Principal = { ...user, mfaVerifiedAt: new Date("2026-03-30T00:00:00Z") };
    const policy = { requireMfa: true, mfaMaxAgeMs: 24 * 60 * 60 * 1000, now };

    expect(resolveRole(verifiedRecently, admin, { associationId: A }, policy)).toBe("association_admin");
    expect(resolveRole(verifiedLongAgo, admin, { associationId: A, teamId: TEAM_X }, policy)).toBe("team_admin");
    expect(resolveRole({ ...user, mfaVerifiedAt: null }, admin, { associationId: A }, policy)).toBe("registered");
  });
});

describe("権限表（§3.2）", () => {
  it("上位は下位を含む", () => {
    expect(roleIncludes("association_admin", "team_admin")).toBe(true);
    expect(roleIncludes("player", "team_admin")).toBe(false);
  });

  // 表の各行 × 各ロール: minRole 以上なら ○、未満なら ×（「本人」の列は self で ○）
  const actions = Object.keys(ACTIONS) as Action[];
  it.each(actions)("%s", (action) => {
    const rule = ACTIONS[action];
    for (const role of ROLES) {
      expect(can(role, action)).toBe(roleIncludes(role, rule.minRole));
      const selfRole: Role | undefined = "selfRole" in rule ? rule.selfRole : undefined;
      expect(can(role, action, { self: true })).toBe(
        roleIncludes(role, rule.minRole) || (!!selfRole && roleIncludes(role, selfRole)),
      );
    }
  });

  it("選手は自分の生年月日・協会員かどうかだけ見られる", () => {
    expect(can("player", "viewPlayerPersonal")).toBe(false);
    expect(can("player", "viewPlayerPersonal", { self: true })).toBe(true);
    expect(can("registered", "viewPlayerPersonal", { self: true })).toBe(false);
    expect(can("team_admin", "viewPlayerPersonal")).toBe(true);
  });

  it("誰でも見られるものと、運営管理者だけのもの", () => {
    expect(can("anonymous", "viewPublic")).toBe(true);
    expect(can("anonymous", "viewTodo")).toBe(false);
    expect(can("association_admin", "manageAssociationAdmins")).toBe(false);
    expect(can("platform_admin", "manageAssociationAdmins")).toBe(true);
  });
});

describe("checkAccess（403 の 3 種類・§3.1）", () => {
  it("未ログインは unauthenticated、セッション切れは session_expired、ログイン中で権限がなければ誰なら見られるか", () => {
    expect(checkAccess("anonymous", "manageTournaments", ANONYMOUS)).toEqual({
      ok: false,
      reason: "unauthenticated",
      who: "協会の管理者",
    });
    expect(checkAccess("anonymous", "manageTournaments", { ...ANONYMOUS, sessionState: "expired" })).toMatchObject({
      reason: "session_expired",
    });
    expect(checkAccess("registered", "manageRoster", user)).toEqual({
      ok: false,
      reason: "no_permission",
      who: "チームの代表者",
    });
    expect(checkAccess("team_admin", "manageRoster", user)).toEqual({ ok: true });
  });
});
