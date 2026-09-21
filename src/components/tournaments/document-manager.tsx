"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { type DocumentField, formatFileSize } from "@/lib/documents/document-input";
import { parseDocumentInput } from "@/lib/documents/document-input";
import {
  type DocumentApiBody,
  type DocumentDraft,
  DocumentDraftFields,
  EMPTY_DOCUMENT_DRAFT,
} from "./document-fields";

// 大会資料の一覧（設計書 §5.9）。公開／非公開・並び順・差し替え・削除をここで行う
// 追加は別のページ（…/documents/new・§4.3「一覧と登録はページを分ける」）

export type DocumentRow = {
  id: string;
  docType: string;
  title: string;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: string;
  // 公開用に置かれているか（置かれていれば公開ページから開ける・C-02）
  published: boolean;
  createdAtText: string;
  publicUrl: string | null;
};

export function DocumentManager({
  slug,
  tournamentId,
  documents,
  isDraftTournament,
  addedId = null,
}: {
  slug: string;
  tournamentId: string;
  documents: DocumentRow[];
  // 下書きの大会は公開用に置かない（§5.9）。画面にもそう書く
  isDraftTournament: boolean;
  // 追加したばかりの資料。1 秒だけ強調する（§4.5「内容が変わった」）
  addedId?: string | null;
}) {
  const router = useRouter();
  const base = `/api/${slug}/admin/tournaments/${tournamentId}/documents`;
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [draft, setDraft] = useState<DocumentDraft>(EMPTY_DOCUMENT_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<DocumentField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const added = addedId ? documents.find((row) => row.id === addedId) : undefined;

  function reset(): void {
    setErrors({});
    setNotice(null);
    setDone(null);
  }

  async function send(
    key: string,
    url: string,
    method: string,
    body: BodyInit | undefined,
    headers: HeadersInit | undefined,
    message: string,
  ) {
    if (pending) return;
    reset();
    setPending(key);
    try {
      const response = await fetch(url, { method, headers, body });
      const parsedBody = (await response.json().catch(() => null)) as DocumentApiBody | null;
      if (response.ok) {
        setDone(message);
        setEditingId(null);
        setDraft(EMPTY_DOCUMENT_DRAFT);
        router.refresh();
        return;
      }
      if (parsedBody?.error?.field) setErrors({ [parsedBody.error.field]: parsedBody.error.message ?? "入力を確かめてください" });
      setNotice(parsedBody?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(null);
    }
  }

  function saveEdit(row: DocumentRow): void {
    const parsedInput = parseDocumentInput(draft);
    if (!parsedInput.ok) {
      setErrors({ [parsedInput.field]: parsedInput.message });
      return;
    }
    void send(
      `edit:${row.id}`,
      `${base}/${row.id}`,
      "PATCH",
      JSON.stringify({ ...draft, isPublic: draft.isPublic }),
      { "content-type": "application/json" },
      `${draft.title}を保存しました`,
    );
  }

  function togglePublic(row: DocumentRow): void {
    void send(
      `toggle:${row.id}`,
      `${base}/${row.id}`,
      "PATCH",
      JSON.stringify({ docType: row.docType, title: row.title, sortOrder: row.sortOrder, isPublic: !row.isPublic }),
      { "content-type": "application/json" },
      row.isPublic ? `${row.title}を非公開にしました` : `${row.title}を公開しました`,
    );
  }

  // ファイルの差し替え（§5.9）。公開中なら新しい名前で置き直すので、前に配った URL は開けなくなる
  function replaceFile(row: DocumentRow): void {
    const file = replaceRefs.current[row.id]?.files?.[0];
    if (!file) {
      setErrors({ file: "差し替えるファイルを選んでください" });
      return;
    }
    if (!window.confirm(`${row.title}のファイルを差し替えます。前に配った資料の URL は開けなくなります。よろしいですか？`)) return;
    const form = new FormData();
    form.set("file", file);
    void send(`replace:${row.id}`, `${base}/${row.id}`, "PUT", form, undefined, `${row.title}のファイルを差し替えました`);
  }

  function remove(row: DocumentRow): void {
    if (!window.confirm(`${row.title}を削除します。公開ページからも見られなくなります。よろしいですか？`)) return;
    void send(`remove:${row.id}`, `${base}/${row.id}`, "DELETE", undefined, undefined, `${row.title}を削除しました`);
  }

  function startEdit(row: DocumentRow): void {
    reset();
    setEditingId(row.id);
    setDraft({ docType: row.docType, title: row.title, isPublic: row.isPublic, sortOrder: row.sortOrder });
  }

  return (
    <div className="flex flex-col gap-4">
      {added ? <Message kind="success" title={`${added.title}を追加しました`} /> : null}
      <Message kind="info" title="個人情報が含まれていないか確認してください">
        公開した資料は、大会に関係のない人でも開けます。組み合わせ表などに載っている氏名は、そのまま公開されます。
        非公開にしたあと、配信の仕組みの都合で最長 1 時間は開ける場合があります。
      </Message>
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      {documents.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">{documents.length} 件</span>
          <Link
            href={`/${slug}/admin/tournaments/${tournamentId}/documents/new`}
            className={`${buttonClass("primary", false, "sm")} ml-auto`}
          >
            資料を追加する
          </Link>
        </Toolbar>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          title="まだ資料はありません"
          description="大会冊子・要項・組み合わせ表などの PDF を追加すると、大会のページに出せます。"
          action={
            <Link href={`/${slug}/admin/tournaments/${tournamentId}/documents/new`} className={buttonClass()}>
              資料を追加する
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger flex flex-col gap-3">
          {documents.map((row) => (
            <li key={row.id}>
              <Card className={`flex flex-col gap-2 ${row.id === addedId ? "bb-highlight" : ""}`}>
                {editingId === row.id ? (
                  <div className="flex flex-col gap-3">
                    <DocumentDraftFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`edit-${row.id}`} />
                    <div className="flex flex-wrap gap-2">
                      <Button pending={pending === `edit:${row.id}`} pendingLabel="保存しています…" onClick={() => saveEdit(row)}>
                        保存する
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingId(null)}>
                        やめる
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone="neutral">{row.docType}</Badge>
                      <span className="font-semibold break-words">{row.title}</span>
                      {row.isPublic ? (
                        <Badge tone={row.published ? "success" : "warning"}>{row.published ? "公開中" : "公開待ち"}</Badge>
                      ) : (
                        <Badge tone="neutral">非公開</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted">
                      {formatFileSize(row.sizeBytes)}・並び順 {row.sortOrder}・{row.createdAtText}
                      {row.isPublic && !row.published && isDraftTournament ? "（大会が下書きのため、まだ公開されません）" : ""}
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className="flex flex-1 flex-col gap-1 text-sm">
                        <span className="font-semibold">ファイルを差し替える</span>
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          ref={(element) => {
                            replaceRefs.current[row.id] = element;
                          }}
                          className="min-h-12 w-full rounded-md border border-border-strong bg-background px-3 py-2 text-base"
                        />
                      </label>
                      <Button
                        variant="secondary"
                        pending={pending === `replace:${row.id}`}
                        pendingLabel="差し替えています…"
                        onClick={() => replaceFile(row)}
                      >
                        差し替える
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.publicUrl ? (
                        <a
                          href={row.publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bb-link inline-flex min-h-12 items-center text-primary no-underline"
                        >
                          開いて確かめる
                        </a>
                      ) : null}
                      <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
                        直す
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={pending === `toggle:${row.id}`}
                        pendingLabel="変えています…"
                        onClick={() => togglePublic(row)}
                      >
                        {row.isPublic ? "非公開にする" : "公開する"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        pending={pending === `remove:${row.id}`}
                        pendingLabel="削除しています…"
                        onClick={() => remove(row)}
                      >
                        削除する
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
