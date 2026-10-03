"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentType } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT, TITLE_MAX } from "@/lib/documents/document-input";
import { DOCUMENT_FILE_CLASS, DOCUMENT_PRIVACY_NOTE, DOCUMENT_SELECT_CLASS } from "./document-fields";

type DocumentApiBody = { document?: { id?: string }; error?: { message?: string; field?: string } };

// 大会資料を追加するページ（設計書 §5.9・§4.3「一覧と登録はページを分ける」）。PDF だけ
export function DocumentUploadForm({ slug, tournamentId }: { slug: string; tournamentId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const listUrl = `/${slug}/admin/tournaments/${tournamentId}/documents`;
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocumentType>("大会冊子");
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function choose(next: File | null) {
    setFile(next);
    setErrors((e) => ({ ...e, file: "" }));
    // タイトルが空ならファイル名（拡張子なし）を入れておく
    if (next && !title.trim()) setTitle(next.name.replace(/\.pdf$/i, "").slice(0, TITLE_MAX));
  }

  async function submit(): Promise<void> {
    if (pending) return;
    const next: Record<string, string> = {};
    if (!file) next.file = "ファイルを選んでください";
    else if (file.size > MAX_DOCUMENT_BYTES) next.file = `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです`;
    if (!title.trim()) next.title = "タイトルを入力してください";
    setErrors(next);
    setNotice(null);
    if (Object.keys(next).length > 0 || !file) return;

    setPending(true);
    const form = new FormData();
    form.set("file", file);
    form.set("docType", docType);
    form.set("title", title.trim());
    form.set("isPublic", isPublic ? "true" : "false");
    try {
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}/documents`, { method: "POST", body: form });
      // 本文は 1 回しか読めないので、成功と失敗の両方をここから取る
      const body = (await response.json().catch(() => null)) as DocumentApiBody | null;
      if (response.ok) {
        router.push(`${listUrl}?added=${encodeURIComponent(body?.document?.id ?? "")}#documents`);
        return;
      }
      const message = body?.error?.message ?? "アップロードできませんでした";
      if (body?.error?.field) setErrors({ [body.error.field]: message });
      else setNotice(message);
    } catch {
      setNotice("アップロードできませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="document-file" className="font-semibold">
            PDF ファイル
          </label>
          <input
            id="document-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            aria-describedby="document-file-hint"
            aria-invalid={errors.file ? true : undefined}
            className={DOCUMENT_FILE_CLASS}
          />
          <p id="document-file-hint" className="text-sm text-muted">
            PDF だけ。1 ファイル {MAX_DOCUMENT_BYTES_TEXT} まで
          </p>
          {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="document-type" className="font-semibold">
            種別
          </label>
          <select id="document-type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className={DOCUMENT_SELECT_CLASS}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <TextField
          id="document-title"
          label="タイトル"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => {
            setTitle(e.target.value);
            setErrors((prev) => ({ ...prev, title: "" }));
          }}
          error={errors.title || undefined}
          hint="大会ページに出る名前（例: 第10回 春季大会 大会冊子）"
        />
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-5" />
          <span>公開する（大会のページから誰でも開けます）</span>
        </label>
        <p className="rounded-md border border-border bg-info-surface px-4 py-3 text-sm">{DOCUMENT_PRIVACY_NOTE}</p>
      </Card>
      <ActionBar>
        <Button pending={pending} pendingLabel="アップロードしています…" onClick={() => void submit()} fullWidth>
          アップロードする
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
