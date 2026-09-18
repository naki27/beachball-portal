import { describe, expect, it } from "vitest";
import { whoCanSee } from "@/lib/page/forbidden";

// 403 の「誰なら見られるか」は URL の規則から決める（docs/adr/0003・§3.2）
describe("whoCanSee", () => {
  it("URL の規則に当たれば、その画面を見られる最も低いロールの呼び名", () => {
    expect(whoCanSee("/platform")).toBe("運営管理者");
    expect(whoCanSee("/platform/associations/x")).toBe("運営管理者");
    expect(whoCanSee("/sawara/admin")).toBe("協会の管理者");
    expect(whoCanSee("/sawara/admin/tournaments?tab=1")).toBe("協会の管理者");
    expect(whoCanSee("/sawara/teams/abc/members")).toBe("チームの選手");
    expect(whoCanSee("/sawara/teams/abc/members/new")).toBe("チームの代表者");
    expect(whoCanSee("/sawara/teams/abc/members/xyz/edit")).toBe("チームの代表者");
    expect(whoCanSee("/sawara/teams/abc")).toBe("チームの選手");
    expect(whoCanSee("/sawara/teams/abc/edit")).toBe("チームの代表者");
    expect(whoCanSee("/sawara/teams/new")).toBe("ログインした人");
    expect(whoCanSee("/mypage")).toBe("ログインした人");
    expect(whoCanSee("/invitations")).toBe("ログインした人");
    expect(whoCanSee("/")).toBe("ログインした人");
  });

  it("当たらなければ一般の言い方", () => {
    expect(whoCanSee("/sawara/something")).toBe("権限のある人");
    expect(whoCanSee("/sawara")).toBe("権限のある人");
  });
});
