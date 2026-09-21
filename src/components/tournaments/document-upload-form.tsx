"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { DOC_MAX_BYTES, type DocumentField, parseDocumentInput } from "@/lib/documents/document-input";
import {
  type DocumentApiBody,
  DocumentDraftFields,
  type DocumentDraft,
  EMPTY_DOCUMENT_DRAFT,
} from "./document-fields";

// 大会資料を追加するページ（設計書 §5.9・§4.3「一覧と登録はページを分ける」）
// 追加できたら一覧へ戻り、足した行が強調される（?added=…）
export function DocumentUploadForm({ slug, tournamentId }: { slug: string; tournamentId: string }) {
  const router = useRouter();
  const listUrl = `/${slug}/admin/tournaments/${tournamentId}/documents`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<DocumentField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(): Promise<void> {
    if (pending) return;
    setErrors({});
    setNotice(null);
    const parsedInput = parseDocumentInput(draft);
    if (!parsedInput.ok) {
      setErrors({ [parsedInput.field]: parsedInput.message });
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErrors({ file: "PDF のファイル（.pdf）を選んでください" });
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      setErrors({ file: `ファイルは ${DOC_MAX_BYTES / 1024 / 1024} MB までです。小さくしてから選んでください` });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("docType", draft.docType);
    form.set("title", draft.title);
    form.set("isPublic", draft.isPublic ? "true" : "false");
    form.set("sortOrder", draft.sortOrder);
    setPending(true);
    try {
      // multipart のときは content-type をブラウザに付けさせる（境界の文字列が必要）
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}/documents`, {
        method: "POST",
        body: form,
      });
      const body = (await response.json().catch(() => null)) as DocumentApiBody | null;
      if (response.ok) {
        router.push(`${listUrl}?added=${encodeURIComponent(body?.documentId ?? "")}`);
        return;
      }
      if (body?.error?.field) setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
      setNotice(body?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Message kind="info" title="個人情報が含まれていないか確認してください">
        公開した資料は、大会に関係のない人でも開けます。組み合わせ表などに載っている氏名は、そのまま公開されます。
      </Message>
      {notice ? <Message kind="error" title={notice} /> : null}
      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-file" className="font-semibold">
            PDF のファイル
          </label>
          <input
            id="doc-file"
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-invalid={errors.file ? true : undefined}
            className={`min-h-12 w-full rounded-md border bg-background px-3 py-2 text-base ${errors.file ? "border-2 border-danger" : "border-border-strong"}`}
          />
          <p className="text-sm text-muted">PDF だけ・{DOC_MAX_BYTES / 1024 / 1024} MB まで</p>
          {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
        </div>
        <DocumentDraftFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="new" />
      </Card>
      <ActionBar>
        <Button pending={pending} pendingLabel="アップロードしています…" onClick={() => void upload()} fullWidth>
          追加する
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
