// 認可の判定はここ 1 か所（設計書 §3.1・§3.2）。UI の出し分けだけで済ませず、Route Handler / Server Action で必ず呼ぶ
// P0: テナント管理者・運営管理者の権限は役割の行があれば付く。P1 の 2 段階認証は AdminPolicy に条件を足すだけで済む形にしておく

export const ROLES = ["anonymous", "registered", "player", "team_admin", "association_admin", "platform_admin"] as const;
export type Role = (typeof ROLES)[number];

// 画面に出す呼び名（§4.4）。403 の「誰なら見られるか」に使う
export const ROLE_LABEL: Record<Role, string> = {
  anonymous: "どなたでも",
  registered: "ログインした人",
  player: "チームの選手",
  team_admin: "チームの代表者",
  association_admin: "協会の管理者",
  platform_admin: "運営管理者",
};

// ログイン中の人（A-09 でセッションから作る）
export type Principal = {
  userId: string | null;
  // none = 未ログイン ／ expired = セッション切れ（403 の文言を分ける・§3.1） ／ active = ログイン中
  sessionState: "none" | "expired" | "active";
  isPlatformAdmin: boolean;
  // 運営管理者が「切り替えて入っている」協会（sessions.entered_association_id。期限内のときだけ入れる・§5.14）
  enteredAssociationId: string | null;
  // 2 段階目を確認した時刻（P1・§9.4）。P0 では常に null
  mfaVerifiedAt: Date | null;
};

export const ANONYMOUS: Principal = {
  userId: null,
  sessionState: "none",
  isPlatformAdmin: false,
  enteredAssociationId: null,
  mfaVerifiedAt: null,
};

// その協会で持っている役割の行（association_admins / team_admins / members.user_id + team_members）
export type AssociationMembership = {
  associationId: string;
  isAssociationAdmin: boolean;
  // 代表者を務めるチーム（team_admins.revoked_at が NULL）
  teamAdminOf: ReadonlySet<string>;
  // 現役の選手として載っているチーム（team_members の left_at・deleted_at が NULL・§3.2）
  playerOf: ReadonlySet<string>;
};

export type Scope = { associationId: string; teamId?: string };

// P1 で 2 段階認証を入れたときに変える場所。P0 は requireMfa: false
export type AdminPolicy = {
  requireMfa: boolean;
  // 2 段階目の確認からこの時間だけ管理者の権限が付く（P1。テナント管理者 24 時間・運営管理者 8 時間【仮】）
  mfaMaxAgeMs?: number;
  now?: Date;
};
export const P0_ADMIN_POLICY: AdminPolicy = { requireMfa: false };

const RANK: Record<Role, number> = {
  anonymous: 0,
  registered: 1,
  player: 2,
  team_admin: 3,
  association_admin: 4,
  platform_admin: 5,
};

// ロールの包含（上位は下位を含む・§3.1）。認可の判定だけに使う（画面の初期表示には使わない）
export function roleIncludes(role: Role, atLeast: Role): boolean {
  return RANK[role] >= RANK[atLeast];
}

function adminPowersActive(principal: Principal, policy: AdminPolicy): boolean {
  if (!policy.requireMfa) return true;
  if (!principal.mfaVerifiedAt) return false;
  const now = policy.now ?? new Date();
  return now.getTime() - principal.mfaVerifiedAt.getTime() <= (policy.mfaMaxAgeMs ?? 0);
}

// 運営管理者として振る舞えるか（/platform 系）
export function isPlatformAdmin(principal: Principal, policy: AdminPolicy = P0_ADMIN_POLICY): boolean {
  return !!principal.userId && principal.isPlatformAdmin && adminPowersActive(principal, policy);
}

// その協会・そのチームでの実効ロール。2 段（テナント → チーム）で判定する（§3.1）
export function resolveRole(
  principal: Principal,
  membership: AssociationMembership | null,
  scope: Scope,
  policy: AdminPolicy = P0_ADMIN_POLICY,
): Role {
  if (!principal.userId) return "anonymous";
  const admin = adminPowersActive(principal, policy);
  // 運営管理者は「切り替えて入った」協会の中ではテナント管理者と同じ。入っていなければ一般の利用者として判定（§5.14）
  if (principal.isPlatformAdmin && admin && principal.enteredAssociationId === scope.associationId) {
    return "association_admin";
  }
  if (membership && membership.associationId === scope.associationId) {
    if (membership.isAssociationAdmin && admin) return "association_admin";
    if (scope.teamId) {
      if (membership.teamAdminOf.has(scope.teamId)) return "team_admin";
      if (membership.playerOf.has(scope.teamId)) return "player";
    }
  }
  return "registered";
}

// 権限表（§3.2）。行 = 操作、minRole = その操作ができる最も低いロール（上位は含む）
// selfRole = 「本人」の列。自分自身の情報なら、このロールでもできる
type ActionRule = { label: string; minRole: Role; selfRole?: Role };

export const ACTIONS = {
  viewPublic: { label: "大会の概要・部・申込期間、参加チーム名・チーム数、公開資料、トップページ", minRole: "anonymous" },
  viewTodo: { label: "トップページの「あなたのやること」", minRole: "registered" },
  createTeam: { label: "チームの作成・個人登録", minRole: "registered" },
  viewOwnTeamRoster: { label: "自チームのチーム名・チームメイトの氏名", minRole: "player" },
  viewOwnTeamEntries: { label: "自チームの申込（大会・部・出場選手名）", minRole: "player" },
  viewPlayerPersonal: { label: "選手の生年月日・年齢・性別", minRole: "team_admin", selfRole: "player" },
  viewMembershipStatus: { label: "協会員かどうか", minRole: "team_admin", selfRole: "player" },
  viewTeamContact: { label: "チームの連絡先（メール・電話）", minRole: "team_admin" },
  // 締切・定員の条件は deadline.ts で判定し、満たさなければ 409（403 と混ぜない）
  manageEntries: { label: "大会への申込・変更・取消", minRole: "team_admin" },
  manageRoster: { label: "選手一覧の編集・選手の招待", minRole: "team_admin" },
  manageTeamAdmins: { label: "代表者の委譲（追加）・解除", minRole: "team_admin" },
  declareMembership: { label: "年度更新の申告", minRole: "team_admin" },
  exportOwnTeamRoster: { label: "自チームの名簿出力", minRole: "team_admin" },
  viewOtherTeams: { label: "他チームの情報", minRole: "association_admin" },
  manageTournaments: { label: "大会・部・資料・トップページの管理", minRole: "association_admin" },
  manageMemberships: { label: "会員の承認・協会全体の名簿出力", minRole: "association_admin" },
  physicalDelete: { label: "物理削除・人物の統合", minRole: "association_admin" },
  viewBilling: { label: "契約の内容・領収書のダウンロード（P1）", minRole: "association_admin" },
  manageAssociationAdmins: { label: "テナント管理者の招待・解除", minRole: "platform_admin" },
  managePlatform: { label: "テナントの作成、全テナントの件数・状態の確認", minRole: "platform_admin" },
} as const satisfies Record<string, ActionRule>;

export type Action = keyof typeof ACTIONS;

export type CanOptions = {
  // 自分自身の情報か（「本人」の列）
  self?: boolean;
};

export function can(role: Role, action: Action, options: CanOptions = {}): boolean {
  const rule: ActionRule = ACTIONS[action];
  if (roleIncludes(role, rule.minRole)) return true;
  return !!(rule.selfRole && options.self && roleIncludes(role, rule.selfRole));
}

// 403 の 3 種類（§3.1・§4.4）
export type ForbiddenReason = "unauthenticated" | "session_expired" | "no_permission";

export type AccessResult =
  | { ok: true }
  // who = 誰なら見られるか（「チームの代表者」など）
  | { ok: false; reason: ForbiddenReason; who: string };

export function checkAccess(role: Role, action: Action, principal: Principal, options: CanOptions = {}): AccessResult {
  if (can(role, action, options)) return { ok: true };
  const who = ROLE_LABEL[ACTIONS[action].minRole];
  if (!principal.userId) {
    return { ok: false, reason: principal.sessionState === "expired" ? "session_expired" : "unauthenticated", who };
  }
  return { ok: false, reason: "no_permission", who };
}
