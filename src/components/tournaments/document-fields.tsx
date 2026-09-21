"use client";

import { TextField } from "@/components/ui/text-field";
import { DOC_TITLE_MAX, DOC_TYPES, type DocumentField } from "@/lib/documents/document-input";

// 大会資料の入力欄（設計書 §5.9）。「追加する」ページと一覧の中の「直す」で同じものを使う

export type DocumentDraft = { docType: string; title: string; isPublic: boolean; sortOrder: string };

export const EMPTY_DOCUMENT_DRAFT: DocumentDraft = { docType: "大会冊子", title: "", isPublic: true, sortOrder: "100" };

export type DocumentApiBody = { error?: { message?: string; field?: DocumentField }; documentId?: string };

export function DocumentDraftFields({
  draft,
  setDraft,
  errors,
  idPrefix,
}: {
  draft: DocumentDraft;
  setDraft: (next: DocumentDraft) => void;
  errors: Partial<Record<DocumentField, string>>;
  idPrefix: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-doc-type`} className="font-semibold">
          種別
        </label>
        <select
          id={`${idPrefix}-doc-type`}
          value={draft.docType}
          onChange={(event) => setDraft({ ...draft, docType: event.target.value })}
          className="min-h-12 w-full rounded-md border border-border-strong bg-background px-3 text-base"
        >
          {DOC_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {errors.docType ? <p className="text-sm font-semibold text-danger">{errors.docType}</p> : null}
      </div>
      <TextField
        id={`${idPrefix}-doc-title`}
        label="タイトル"
        value={draft.title}
        maxLength={DOC_TITLE_MAX}
        error={errors.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <TextField
        id={`${idPrefix}-doc-sort`}
        label="並び順"
        inputMode="numeric"
        value={draft.sortOrder}
        error={errors.sortOrder}
        hint="小さい数が先に出ます"
        onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
      />
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          checked={draft.isPublic}
          onChange={(event) => setDraft({ ...draft, isPublic: event.target.checked })}
          className="size-6"
        />
        <span className="font-semibold">公開する（大会ページに出す）</span>
      </label>
    </>
  );
}
