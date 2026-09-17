## 付録 E. 部門バリデーションの擬似コード

```ts
// src/lib/eligibility.ts
type Player = { name: string; birthDate: PlainDate; sex: "male" | "female" };
type Preset = {
  gender: "male" | "female" | "mixed";
  ruleType: "free" | "min_age" | "total_age";
  ruleValue: number | null;
  courtSize: number;        // 既定 4
  mixedMinMale: number;     // 既定 1
  mixedMinFemale: number;   // 既定 2
};
type Issue = { level: "error" | "warning"; message: string };  // error は送信不可、warning は送信できる（§5.5 の警告の一覧）
type Info  = { label: string; value: string };  // 画面に表示するだけの情報

// DB を見る必要があるものは送信処理の側で判定する（§5.5 の警告の一覧）:
//   同じ大会の別の申込との重複 → 警告（needsAdminCheck は立てない・v0.9.1）
//   手入力の選手が名寄せで needs_review → needsAdminCheck を立てる
export function validateEligibility(
  players: Player[], preset: Preset, referenceDate: PlainDate,
): { issues: Issue[]; infos: Info[]; needsAdminCheck: boolean } {
  const issues: Issue[] = [];
  const infos: Info[] = [];
  let needsAdminCheck = false;
  const ages = players.map((p) => ({ ...p, age: ageAt(p.birthDate, referenceDate) }));

  // --- 性別 ---
  if (preset.gender === "male" || preset.gender === "female") {
    const jp = preset.gender === "male" ? "男子" : "女子";
    for (const p of players) {
      if (p.sex !== preset.gender) {
        issues.push({ level: "error", message: `${p.name}さんはこの部門（${jp}）の対象ではありません` });
      }
    }
  } else {
    // 混合: コート ${courtSize} 名で「男 ${mixedMinMale} 以上・女 ${mixedMinFemale} 以上」を
    // 満たす編成が組めるか。登録名簿がその人数を満たしていればよい
    const males = players.filter((p) => p.sex === "male").length;
    const females = players.filter((p) => p.sex === "female").length;
    if (males < preset.mixedMinMale) {
      issues.push({ level: "error",
        message: `混合の部は男子${preset.mixedMinMale}名以上の登録が必要です（現在${males}名）` });
    }
    if (females < preset.mixedMinFemale) {
      issues.push({ level: "error",
        message: `混合の部は女子${preset.mixedMinFemale}名以上の登録が必要です（現在${females}名）` });
    }
  }

  // --- 年齢下限: 全員が対象 ---
  if (preset.ruleType === "min_age" && preset.ruleValue != null) {
    for (const a of ages) {
      if (a.age < preset.ruleValue) {
        issues.push({ level: "error",
          message: `この部門は${preset.ruleValue}歳以上が対象です（${a.name}さんは${a.age}歳）` });
      }
    }
  }

  // --- 合計年齢: 判定しない。運営が確認するための数字を出すだけ（§14-20） ---
  if (preset.ruleType === "total_age" && preset.ruleValue != null) {
    const n = preset.courtSize;
    const sorted = [...ages].sort((x, y) => x.age - y.age);
    const min = sorted.slice(0, n).reduce((t, a) => t + a.age, 0);
    const max = sorted.slice(-n).reduce((t, a) => t + a.age, 0);
    // 画面では 1 行で表示する（§4.4）
    infos.push({ label: "合計年齢",
      value: `${min}歳〜${max}歳（出場する${n}人によって変わります。運営が確認します）` });
    infos.push({ label: "この部の基準", value: `${preset.ruleValue}歳以上` });
    needsAdminCheck = true;                      // 合計年齢の部は運営の確認対象（§5.5）
  }

  return { issues, infos, needsAdminCheck };
}
```

