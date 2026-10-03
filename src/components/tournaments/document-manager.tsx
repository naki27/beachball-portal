"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentType } from "@/db/schema";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT, PUBLIC_CACHE_TEXT, TITLE_MAX } from "@/lib/documents/document-input";
import { DOCUMENT_FILE_CLASS, DOCUMENT_PRIVACY_NOTE, DOCUMENT_SELECT_CLASS, readDocumentError } from "./document-fields";

// 大会資料の一覧（設計書 §5.9）。種別・タイトル・公開／非公開・並び順の編集、差し替え、削除
// 追加するのは別のページ（§4.3「一覧と登録はページを分ける」）。中身はシステムでは検査しないので、管理者に注意書きを出す

export type DocumentRowView = {
  id: string;
  docType: DocumentType;
  title: string;
  isPublic: boolean;
  // いま公開用に置かれているか（「公開」でも大会が準備中の間は置かれない）
  published: boolean;
  sortOrder: number;
  sizeText: string;
  createdText: string;
};

export function DocumentManager({
  slug,
  tournamentId,
  tournamentIsDraft,
  documents,
  addedId = null,
}: {
  slug: string;
  tournamentId: string;
  tournamentIsDraft: boolean;
  documents: DocumentRowView[];
  addedId?: string | null;
}) {
  const hydrated = useHydrated();
  const newUrl = `/${slug}/admin/tournaments/${tournamentId}/documents/new`;
  const added = addedId ? documents.find((row) => row.id === addedId) : undefined;

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {added ? <Message kind="success" title={`「${added.title}」を追加しました`} /> : null}
      {tournamentIsDraft && documents.length > 0 ? (
        <Message kind="info" title="大会が「準備中」の間は、「公開」の資料も大会のページに出ません。大会を「受付中」などにすると公開されます" />
      ) : null}

      {documents.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">{documents.length} 件</span>
          <Link href={newUrl} className={`${buttonClass("primary", false, "sm")} ml-auto`}>
            資料を追加する
          </Link>
        </Toolbar>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          title="まだ資料はありません"
          description="大会冊子・要項・組み合わせ・結果などの PDF を置けます。"
          action={
            <Link href={newUrl} className={buttonClass()}>
              資料を追加する
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger flex flex-col gap-3">
          {documents.map((d) => (
            <li key={d.id}>
              <DocumentRow slug={slug} tournamentId={tournamentId} document={d} highlighted={d.id === addedId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({
  slug,
  tournamentId,
  document,
  highlighted,
}: {
  slug: string;
  tournamentId: string;
  document: DocumentRowView;
  highlighted: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "replace" | "delete">("view");
  const [docType, setDocType] = useState<DocumentType>(document.docType);
  const [title, setTitle] = useState(document.title);
  const [isPublic, setIsPublic] = useState(document.isPublic);
  const [sortOrder, setSortOrder] = useState(String(document.sortOrder));
  const [replacement, setReplacement] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { type: `doc-${document.id}-type`, title: `doc-${document.id}-title`, order: `doc-${document.id}-order`, file: `doc-${document.id}-file` };
  const apiUrl = `/api/${slug}/admin/tournaments/${tournamentId}/documents/${document.id}`;
  const openUrl = `/${slug}/tournaments/${tournamentId}/documents/${document.id}`;

  function reset() {
    setDocType(document.docType);
    setTitle(document.title);
    setIsPublic(document.isPublic);
    setSortOrder(String(document.sortOrder));
    setReplacement(null);
    setErrors({});
    setFailure(null);
    setMode("view");
  }

  // 3 つの操作で共通: 送る → 失敗なら欄かメッセージに出す → 成功なら一覧を読み直す
  async function send(init: RequestInit, fallback: string, onDone: () => void) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setNotice(null);
    setErrors({});
    try {
      const response = await fetch(apiUrl, init);
      if (!response.ok) {
        const error = await readDocumentError(response, fallback);
        if (error.field) setErrors({ [error.field]: error.message });
        else setFailure(error.message);
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setFailure(`${fallback}。電波の状態を確かめてください`);
    } finally {
      setPending(false);
    }
  }

  function save() {
    if (!title.trim()) {
      setErrors({ title: "タイトルを入力してください" });
      return;
    }
    void send(
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ docType, title: title.trim(), isPublic, sortOrder }) },
      "保存できませんでした",
      () => setMode("view"),
    );
  }

  function replace() {
    if (!replacement) {
      setErrors({ file: "ファイルを選んでください" });
      return;
    }
    if (replacement.size > MAX_DOCUMENT_BYTES) {
      setErrors({ file: `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです` });
      return;
    }
    const form = new FormData();
    form.set("file", replacement);
    void send({ method: "PUT", body: form }, "差し替えられませんでした", () => {
      setReplacement(null);
      setMode("view");
      setNotice("ファイルを差し替えました。公開中なら、開くための URL が新しくなっています");
    });
  }

  function remove() {
    void send({ method: "DELETE" }, "削除できませんでした", () => setMode("view"));
  }

  return (
    <Card className={`flex flex-col gap-2 ${highlighted ? "bb-highlight" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{document.docType}</Badge>
        <Badge tone={document.isPublic ? "success" : "neutral"}>{document.isPublic ? "公開" : "非公開"}</Badge>
        <span className="text-muted">並び順 {document.sortOrder}</span>
      </div>
      <p className="font-semibold break-words">{document.title}</p>
      <p className="text-sm text-muted">
        {document.sizeText}・{document.createdText} に追加
      </p>
      {document.published ? (
        <p className="text-sm">
          <a href={openUrl} target="_blank" rel="noopener" className="bb-link text-primary">
            大会ページと同じ URL で開く
          </a>
          （新しいタブ）
        </p>
      ) : document.isPublic ? (
        <p className="text-sm text-muted">大会が「準備中」のため、まだ公開されていません</p>
      ) : null}
      {notice ? <Message kind="success" title={notice} /> : null}
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}

      {mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-10" onClick={() => setMode("edit")}>
            変更する
          </Button>
          <Button variant="secondary" className="min-h-10" onClick={() => setMode("replace")}>
            ファイルを差し替える
          </Button>
          <Button variant="danger" className="min-h-10" onClick={() => setMode("delete")}>
            削除する
          </Button>
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.type} className="font-semibold">
              種別
            </label>
            <select id={ids.type} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className={DOCUMENT_SELECT_CLASS}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <TextField id={ids.title} label="タイトル" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} error={errors.title || undefined} />
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-5" />
            <span>公開する</span>
          </label>
          <p className="text-sm text-muted">非公開にしても、すでに開いていた人は最長 {PUBLIC_CACHE_TEXT} は開けることがあります</p>
          <TextField
            id={ids.order}
            label="並び順"
            value={sortOrder}
            inputMode="numeric"
            onChange={(e) => setSortOrder(e.target.value)}
            error={errors.sortOrder || undefined}
            hint="小さい順に並びます"
            className="max-w-32"
          />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10" onClick={save} pending={pending} pendingLabel="保存しています…">
              保存する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "replace" ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.file} className="font-semibold">
              新しい PDF ファイル
            </label>
            <input
              id={ids.file}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setReplacement(e.target.files?.[0] ?? null);
                setErrors({});
              }}
              aria-invalid={errors.file ? true : undefined}
              className={DOCUMENT_FILE_CLASS}
            />
            <p className="text-sm text-muted">
              タイトルや公開の設定はそのまま。公開中なら開くための URL が新しくなり、古い URL は開けなくなります（最長 {PUBLIC_CACHE_TEXT}{" "}
              は古いほうが開けることがあります）
            </p>
            {errors.file ? <p className="text-sm font-semibold text-danger">{errors.file}</p> : null}
          </div>
          <p className="rounded-md border border-border bg-info-surface px-4 py-3 text-sm">{DOCUMENT_PRIVACY_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10" onClick={replace} pending={pending} pendingLabel="差し替えています…">
              差し替える
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
          <p className="text-sm">削除すると大会のページから消え、開くための URL も使えなくなります。「削除済みデータ」から元に戻せます。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" className="min-h-10" onClick={remove} pending={pending} pendingLabel="削除しています…">
              削除する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={reset} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
