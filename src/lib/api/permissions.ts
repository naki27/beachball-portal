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
  // 協会の中で、ログインしていなくても見られるもの（§5.6）。協会は解決するが、ログインは求めない
  | { kind: "publicTenant"; action: Action }
  // 運営管理者だけ（/api/platform/…）
  | { kind: "platform"; action: Action };

export type ApiPermission = {
  // src/app/api/ からの相対パス（route.ts を除いたもの）
  path: string;
  methods: readonly HttpMethod[];
  guard: ApiGuard;
};

export const API_PERMISSIONS: readonly ApiPermission[] = [
  // 協会の中（誰でも見られる・§5.6）。応答に選手の情報を入れない
  { path: "[slug]/tournaments", methods: ["GET"], guard: { kind: "publicTenant", action: "viewPublic" } },
  { path: "[slug]/tournaments/[tournamentId]", methods: ["GET"], guard: { kind: "publicTenant", action: "viewPublic" } },
  { path: "[slug]/tournaments/[tournamentId]/entries", methods: ["GET"], guard: { kind: "publicTenant", action: "viewPublic" } },
  // 申込の作成。入口はログインした人まで（チームの代表者かは送信時にサービス層が検査する・§5.5）
  { path: "[slug]/tournaments/[tournamentId]/entries", methods: ["POST"], guard: { kind: "tenant", action: "manageEntries" } },

  // 申込の参照・変更・取消（§5.5(d)）。GET は選手も見られる（サービス層が §3.2 で絞る）。
  // 締切後の代表者の PATCH / DELETE は 409（管理者は可）
  { path: "[slug]/entries/[entryId]", methods: ["GET"], guard: { kind: "tenant", action: "viewOwnTeamEntries" } },
  { path: "[slug]/entries/[entryId]", methods: ["PATCH", "DELETE"], guard: { kind: "tenant", action: "manageEntries" } },

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
  // 前回コピー（§5.5(b)）。前回の選手の氏名を返すので、そのチームの代表者だけ
  { path: "[slug]/teams/[teamId]/entries/latest", methods: ["GET"], guard: { kind: "tenant", action: "manageEntries" } },
  // 年度更新の申告（§5.12）。締切後の代表者は 409（テナント管理者は代理で送れる）
  { path: "[slug]/teams/[teamId]/membership", methods: ["POST"], guard: { kind: "tenant", action: "declareMembership" } },
  // 紐づけの解除は本人とテナント管理者だけ（§3.2 の注）。サービス層で本人かを見る
  { path: "[slug]/members/[memberId]/link", methods: ["DELETE"], guard: { kind: "tenant", action: "viewOwnTeamRoster" } },
  // 申込の選手枠のサジェストと「この方ですか？」（§8.4・§8.3）。候補は代表者を務めるチームの選手だけなので、
  // 返してよい情報の行は「選手の生年月日・年齢・性別」。代表者を務めるチームがなければ結果が 0 件になる（403 にはしない）
  { path: "[slug]/members/suggest", methods: ["POST"], guard: { kind: "tenant", action: "viewPlayerPersonal" } },
  { path: "[slug]/members/same-name", methods: ["POST"], guard: { kind: "tenant", action: "viewPlayerPersonal" } },

  // 協会の管理（テナント管理者・切り替えて入った運営管理者）
  // 申込一覧と CSV（§5.5(f)）。CSV の出力は export_logs に記録する
  { path: "[slug]/admin/entries/[entryId]/checked", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  // 誤登録の申込の論理削除（§5.16）。完全に削除するのは /admin/trash から
  { path: "[slug]/admin/entries/[entryId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/tournaments/[tournamentId]/entries/exports", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/teams/[teamId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/teams/[teamId]/admins", methods: ["POST"], guard: { kind: "tenant", action: "viewOtherTeams" } },
  { path: "[slug]/admin/teams/[teamId]/members/[teamMemberId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/members/[memberId]", methods: ["PATCH"], guard: { kind: "tenant", action: "viewOtherTeams" } },
  { path: "[slug]/admin/members/[memberId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  // 要確認の解消と人物の統合（§5.8）。統合は権限表の「物理削除・人物の統合」の行
  { path: "[slug]/admin/members/[memberId]/reviewed", methods: ["POST"], guard: { kind: "tenant", action: "viewOtherTeams" } },
  { path: "[slug]/admin/members/[memberId]/merge", methods: ["POST"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/tournaments", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]", methods: ["PATCH"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]", methods: ["DELETE"], guard: { kind: "tenant", action: "physicalDelete" } },
  { path: "[slug]/admin/tournaments/[tournamentId]/categories", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]/categories/[categoryId]", methods: ["PATCH", "DELETE"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]/age-reference/confirm", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  // 大会資料（§5.9）。アップロードと差し替え（PUT）は multipart、編集は JSON。削除は論理削除（完全に削除するのは /admin/trash から）
  { path: "[slug]/admin/tournaments/[tournamentId]/documents", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/tournaments/[tournamentId]/documents/[documentId]", methods: ["PATCH", "PUT", "DELETE"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/category-presets", methods: ["POST"], guard: { kind: "tenant", action: "manageTournaments" } },
  { path: "[slug]/admin/category-presets/[presetId]", methods: ["PATCH", "DELETE"], guard: { kind: "tenant", action: "manageTournaments" } },
  // 年度更新の受付（§5.12「受付開始」）。会員の承認の行
  { path: "[slug]/admin/memberships/periods", methods: ["POST"], guard: { kind: "tenant", action: "manageMemberships" } },
  { path: "[slug]/admin/memberships/periods/[periodId]", methods: ["PATCH"], guard: { kind: "tenant", action: "manageMemberships" } },
  // 申告の一括承認（通常・追加）。年度は URL の数字
  { path: "[slug]/admin/memberships/[year]/approve", methods: ["POST"], guard: { kind: "tenant", action: "manageMemberships" } },
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
  publicTenant: ["resolveAssociationForApi"],
  loggedIn: ["requireLoggedIn", "principal.userId"],
  tenant: ["requireTenantUser"],
  platform: ["requirePlatformAdmin", "isPlatformAdmin"],
};
