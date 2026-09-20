// pnpm db:seed:dev — 開発用のサンプルデータ（チーム 3・選手 20・返事待ちの招待 1・大会 2）。本番では使わない
// 画面を触って確かめるための下ごしらえ。追加はサービス層（registerTeam・addPlayer・invitePlayer）を通すので、
// 名寄せ・代表者の行・招待のメール（mail_logs）も本物と同じようにできる。何度流しても増えない（あれば作らない）
import { and, eq, isNull } from "drizzle-orm";
import { addCategoriesFromPresets } from "../../lib/admin/categories";
import { createTournament } from "../../lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../lib/authz";
import { formatPlainDate, todayInTokyo } from "../../lib/date";
import { listCategoryPresets } from "../../lib/repo/category-presets";
import { invitePlayer } from "../../lib/teams/invitations";
import { addPlayer } from "../../lib/teams/roster";
import { registerTeam } from "../../lib/teams/teams";
import { closeDb, createDb, type Db } from "../client";
import { loadEnv, requireEnv } from "../env";
import { associationAdmins, teams, tournaments, users } from "../schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../seed";
import { withTenantOn } from "../tenant";

// ログインして試すためのアドレス（Mailpit に確認番号が届く）
const DAIHYO_EMAIL = "dev-daihyo@example.com";
const SENSHU_EMAIL = "dev-senshu@example.com";
const KANRI_EMAIL = "dev-kanri@example.com"; // 協会の管理者（大会の管理を試す人）

type SampleTeam = { name: string; kana: string; membershipRenewalTarget: boolean; players: readonly SamplePlayer[] };
type SamplePlayer = { name: string; kana: string; birthDate: string; sex: "male" | "female" };

const p = (name: string, kana: string, birthDate: string, sex: "male" | "female"): SamplePlayer => ({ name, kana, birthDate, sex });

// チーム 3・選手 20（年齢と性別を散らす。同じ人物が 2 つのチームにいる例も入れる）
const SAMPLE_TEAMS: readonly SampleTeam[] = [
  {
    name: "早良さくら", kana: "さわらさくら", membershipRenewalTarget: true,
    players: [
      p("山田 太郎", "やまだ たろう", "1958-04-12", "male"),
      p("山田 花子", "やまだ はなこ", "1960-11-03", "female"),
      p("佐藤 一郎", "さとう いちろう", "1972-06-21", "male"),
      p("佐藤 美咲", "さとう みさき", "1975-02-14", "female"),
      p("鈴木 健太", "すずき けんた", "1988-09-30", "male"),
      p("高橋 由美", "たかはし ゆみ", "1991-01-08", "female"),
      p("田中 悟", "たなか さとる", "1949-07-19", "male"),
      p("伊藤 京子", "いとう きょうこ", "1953-03-25", "female"),
    ],
  },
  {
    name: "西新クラブ", kana: "にしじんくらぶ", membershipRenewalTarget: true,
    players: [
      p("渡辺 修", "わたなべ おさむ", "1965-05-05", "male"),
      p("小林 直美", "こばやし なおみ", "1968-08-17", "female"),
      p("加藤 進", "かとう すすむ", "1980-12-01", "male"),
      p("吉田 彩", "よしだ あや", "1983-10-23", "female"),
      p("山本 大輔", "やまもと だいすけ", "1996-04-09", "male"),
      p("中村 千春", "なかむら ちはる", "1999-06-28", "female"),
      // 早良さくらにもいる人（氏名・生年月日・性別が同じなので、人物は 1 件のまま・§8.3）
      p("山田 太郎", "やまだ たろう", "1958-04-12", "male"),
    ],
  },
  {
    name: "百道はまかぜ", kana: "ももちはまかぜ", membershipRenewalTarget: false,
    players: [
      p("斎藤 実", "さいとう みのる", "1944-02-02", "male"),
      p("松本 光子", "まつもと みつこ", "1947-09-15", "female"),
      p("井上 和也", "いのうえ かずや", "1978-07-07", "male"),
      p("木村 優", "きむら ゆう", "2004-03-18", "female"),
      p("林 拓海", "はやし たくみ", "2006-05-26", "male"),
    ],
  },
];

async function findOrCreateUser(db: Db, email: string): Promise<string> {
  const [found] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  if (found) return found.id;
  const [created] = await db.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  return created.id;
}

// その日からの相対で日付を作る（何日たっても「受付中」「締切後」のままにする）
function dayFrom(days: number): string {
  const base = todayInTokyo();
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return formatPlainDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

// 大会 2 つ（受付中・締切後）。部は「よく使う部」から選んで足す（§5.6 の公開ページを試すため）
async function seedTournaments(db: Db): Promise<number> {
  const adminId = await findOrCreateUser(db, KANRI_EMAIL);
  await withTenantOn(db, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: adminId }).onConflictDoNothing(),
  );
  const actor: Principal & { userId: string } = { ...ANONYMOUS, userId: adminId, sessionState: "active" };
  // すでに入れてあれば何もしない（チームとは別に数える。何度流しても増やさない）
  const already = await withTenantOn(db, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.createdBy, adminId)),
  );
  if (already.length > 0) return already.length;
  const presets = await withTenantOn(db, SAWARA_ASSOCIATION_ID, (tx) => listCategoryPresets(tx, SAWARA_ASSOCIATION_ID, { onlyActive: true }));
  const pick = (codes: readonly string[]) => presets.filter((preset) => codes.includes(preset.code)).map((preset) => preset.id);

  const samples = [
    {
      name: "早良区ビーチボール大会（春季）",
      eventDate: dayFrom(45),
      entryStartDate: dayFrom(-10),
      entryEndDate: dayFrom(14), // 受付中
      codes: ["m_40", "m_60", "w_40", "w_60", "x_160"],
    },
    {
      name: "早良区ビーチボール大会（冬季）",
      eventDate: dayFrom(-30),
      entryStartDate: dayFrom(-90),
      entryEndDate: dayFrom(-60), // 締切後
      codes: ["m_free", "w_free", "x_free"],
    },
  ];

  for (const sample of samples) {
    const tournament = await createTournament(db, actor, SAWARA_ASSOCIATION_ID, {
      name: sample.name,
      eventDate: sample.eventDate,
      ageReferenceDate: sample.eventDate,
      venue: "早良体育館",
      description: "参加費は 1 チーム 3,000 円です。当日、受付でお支払いください。",
      entryStartDate: sample.entryStartDate,
      entryEndDate: sample.entryEndDate,
      teamSizeMin: "4",
      teamSizeMax: "8",
      maxEntries: "",
      status: "open",
    });
    await addCategoriesFromPresets(db, actor, SAWARA_ASSOCIATION_ID, tournament.id, { presetIds: pick(sample.codes), mixedNotation: "kanji" });
  }
  return samples.length;
}

export type SeedDevResult = { teams: number; players: number; invitations: number; tournaments: number; skipped: boolean };

export async function seedDev(db: Db): Promise<SeedDevResult> {
  const daihyoId = await findOrCreateUser(db, DAIHYO_EMAIL);
  await findOrCreateUser(db, SENSHU_EMAIL);

  // すでに入れてあれば何もしない（何度流しても増やさない）
  const existing = await withTenantOn(db, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.select({ id: teams.id }).from(teams).where(eq(teams.createdBy, daihyoId)),
  );
  // 大会はチームと別に入れる（チームがすでにあっても、大会だけ足せる）
  const tournamentCount = await seedTournaments(db);
  if (existing.length > 0) return { teams: existing.length, players: 0, invitations: 0, tournaments: tournamentCount, skipped: true };

  const actor: Principal & { userId: string } = { ...ANONYMOUS, userId: daihyoId, sessionState: "active" };
  const result: SeedDevResult = { teams: 0, players: 0, invitations: 0, tournaments: 0, skipped: false };
  let firstTeamId = "";
  let firstMemberId = "";

  for (const sample of SAMPLE_TEAMS) {
    const team = await registerTeam(
      db,
      SAWARA_ASSOCIATION_ID,
      daihyoId,
      { name: sample.name, kana: sample.kana, contactEmail: null, contactPhone: null, membershipRenewalTarget: sample.membershipRenewalTarget },
      { confirmSameName: true },
    );
    result.teams++;
    for (const player of sample.players) {
      const added = await addPlayer(db, actor, SAWARA_ASSOCIATION_ID, team.id, player);
      result.players++;
      if (!firstTeamId) {
        firstTeamId = team.id;
        firstMemberId = added.memberId;
      }
    }
  }

  // 返事待ちの招待 1 件（pnpm job:mail で Mailpit に届く）
  await invitePlayer(db, actor, SAWARA_ASSOCIATION_ID, firstTeamId, { memberId: firstMemberId, email: SENSHU_EMAIL });
  result.invitations++;
  result.tournaments = tournamentCount;
  return result;
}

async function main(): Promise<void> {
  loadEnv();
  if (process.env.NODE_ENV === "production") throw new Error("本番では使いません");
  const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  try {
    const result = await seedDev(db);
    if (result.skipped) {
      console.log(`サンプルデータはすでにあります（チーム ${result.teams}・大会 ${result.tournaments}）。作り直すには pnpm db:reset から`);
      return;
    }
    // メールアドレスはログに出さない（§12「ログ」）。画面での試し方は README
    console.log(
      `サンプルデータ: チーム ${result.teams}・選手 ${result.players}・招待 ${result.invitations}・大会 ${result.tournaments} 件を /${SAWARA_SLUG} に入れました`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
