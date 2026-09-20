import type { Action } from "@/lib/authz";

// API の権限表（設計書 §3.2 の行と、1a で作った API の対応）。行の内容そのもの（どのロールができるか）は
// src/lib/authz.ts の ACTIONS が唯一のデータで、ここはその行と URL を結ぶだけ（§12.1「権限表のテスト」）
// tests/db/permissions.test.ts が、この表と src/app/api/ の実物が食い違っていないことを確かめる
// API を足したら、この表にも 1 行足す（足さないとテストが落ちる）

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ApiGuard =
  // 誰でも使える（ログイン・問い合わせ・死活監視）
  | { kind: "public" }
  // ログインした人が自分の情報に対してだけ使う（/api/me/…）
  | { kind: "loggedIn" }
  // 協会の中の資源。requireTenantUser で協会を解決してから、サービス層が §3.2 の行で判定する
  | { kind: "tenant"; action: Action }
  // 運営管理者だけ（/api/platform/…）
  | { kind: "platform"; action: Action };

export type ApiPermission = {
  // src/app/api/ からの相対パス（route.ts を除いたもの）
  path: string;
  methods: readonly HttpMethod[];
  guard: ApiGuard;
};

export const API_PERMISSIONS: readonly ApiPermission[] = [
  // 協会の中（代表者・選手）
  { path: "[slug]/teams", methods: ["POST"], guard: { kind: "tenant", action: "createTeam" } },
  { path: "[slug]/teams/[teamId]", methods: ["PATCH"], guard: { kind: "tenant", action: "editTeam" } },
  { path: "[slug]/teams/[teamId]/members", methods: ["GET"], guard: { kind: "tenant", action: "viewOwnTeamRoster" } },
  { path: "[slug]/teams/[teamId]/members", methods: ["POST"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/members/[teamMemberId]", methods: ["PATCH"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/members/[teamMemberId]/leave", methods: ["POST"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/members/[teamMemberId]/undo-leave", methods: ["POST"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/invitations", methods: ["POST"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/invitations/[invitationId]", methods: ["DELETE"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/invitations/[invitationId]/resend", methods: ["POST"], guard: { kind: "tenant", action: "manageRoster" } },
  { path: "[slug]/teams/[teamId]/admins/[userId]", methods: ["DELETE"], guard: { kind: "tenant", action: "manageTeamAdmins" } },
  // 紐づけの解除は本人とテナント管理者だけ（§3.2 の注）。サービス層で本人かを見る
  { path: "[slug]/members/[memberId]/link", methods: ["DELETE"], guard: { kind: "tenant", action: "viewOwnTeamRoster" } },

  // 協会の管理（テナント管理者・切り替えて入った運営管理者）
  { path: "[slug]/admin/teams/[teamId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/teams/[teamId]/admins", methods: ["POST"], guard: { kind: "tenant", action: "viewOtherTeams" } },
  { path: "[slug]/admin/teams/[teamId]/members/[teamMemberId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/members/[memberId]", methods: ["PATCH"], guard: { kind: "tenant", action: "viewOtherTeams" } },
  { path: "[slug]/admin/members/[memberId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/tournaments", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]", methods: ["PATCH"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/contacts", methods: ["PATCH"], guard: { kind: "tenant", action: "manageContacts" } },
  { path: "[slug]/admin/contacts/[id]", methods: ["DELETE"], guard: { kind: "tenant", action: "manageContacts" } },
  { path: "[slug]/admin/trash", methods: ["GET"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/trash/[table]/[id]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/trash/[table]/[id]/restore", methods: ["POST"], guard: { kind: "tenant", action: "physicalDelete" } },

  // 運営管理（§3.2 の下 2 行）
  { path: "platform/associations", methods: ["GET", "POST"], guard: { kind: "platform", action: "managePlatform" } },
  { path: "platform/associations/[id]", methods: ["PATCH"], guard: { kind: "platform", action: "managePlatform" } },
  { path: "platform/associations/[id]/enter", methods: ["POST", "DELETE"], guard: { kind: "platform", action: "managePlatform" } },
  { path: "platform/associations/[id]/admin-invitations", methods: ["POST", "DELETE"], guard: { kind: "platform", action: "manageAssociationAdmins" } },
  { path: "platform/associations/[id]/admins/[userId]", methods: ["DELETE"], guard: { kind: "platform", action: "manageAssociationAdmins" } },
  { path: "platform/contacts", methods: ["PATCH"], guard: { kind: "platform", action: "managePlatformContacts" } },

  // 自分の情報（ログインした人）
  { path: "me", methods: ["GET", "PATCH", "DELETE"], guard: { kind: "loggedIn" } },
  { path: "me/associations", methods: ["GET"], guard: { kind: "loggedIn" } },
  { path: "me/invitations", methods: ["GET"], guard: { kind: "loggedIn" } },
  { path: "me/invitations/[id]/accept", methods: ["POST"], guard: { kind: "loggedIn" } },
  { path: "me/invitations/[id]/reject", methods: ["POST"], guard: { kind: "loggedIn" } },
  { path: "me/email/request", methods: ["POST"], guard: { kind: "loggedIn" } },
  { path: "me/email/verify", methods: ["POST"], guard: { kind: "loggedIn" } },

  // 誰でも（ログイン・問い合わせ・死活監視）
  { path: "auth/request", methods: ["POST"], guard: { kind: "public" } },
  { path: "auth/verify", methods: ["POST"], guard: { kind: "public" } },
  { path: "auth/logout", methods: ["POST"], guard: { kind: "public" } },
  { path: "contact", methods: ["POST"], guard: { kind: "public" } },
  { path: "site-contact", methods: ["POST"], guard: { kind: "public" } },
  { path: "health", methods: ["GET"], guard: { kind: "public" } },
] as const;

// route.ts の中に必ず出てくる入口（この文字列がなければ、認可の検査を忘れている）
export const GUARD_TOKENS: Record<ApiGuard["kind"], readonly string[]> = {
  public: [],
  loggedIn: ["requireLoggedIn", "principal.userId"],
  tenant: ["requireTenantUser"],
  platform: ["requirePlatformAdmin", "isPlatformAdmin"],
};
