"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// 「個人で登録する」を受け付けるかの切り替え（K-02・ADR 0032）。テナント管理者だけ
// 止めると、トップ・マイページの入口が消え、登録のページと API は 404 になる（すでに登録された人はそのまま）
export function IndividualRegistrationSwitch({ slug, enabled }: { slug: string; enabled: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string } | null>(null);

  async function change(next: boolean) {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/admin/association`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ individualRegistrationEnabled: next }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "変えられませんでした" });
        return;
      }
      setNotice({ kind: "success", title: next ? "個人での登録を受け付けます" : "個人での登録を止めました" });
      router.refresh();
    } catch {
      setNotice({ kind: "error", title: "変えられませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="font-semibold">いまの設定: {enabled ? "受け付ける" : "受け付けない"}</p>
            <p className="text-sm text-muted">
              受け付けないときは、トップページとマイページから「個人で登録する」が消えます。すでに個人で登録した人はそのままです。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 self-start sm:self-auto"
            onClick={() => change(!enabled)}
            pending={pending}
            pendingLabel="変えています…"
          >
            {enabled ? "受け付けないようにする" : "受け付けるようにする"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
