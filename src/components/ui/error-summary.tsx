"use client";

export type FieldError = { id: string; label: string; message: string };

// ページ上部の「2 か所に入力の誤りがあります」（§4.5）。項目をタップするとその欄へ移動して焦点を当てる
export function ErrorSummary({ errors, className = "" }: { errors: FieldError[]; className?: string }) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`bb-slide-in flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3 ${className}`}
    >
      <p className="font-semibold text-danger">{errors.length} か所に入力の誤りがあります</p>
      <ul className="flex flex-col gap-1">
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className="inline-flex min-h-10 items-center underline underline-offset-2"
              onClick={(event) => {
                const target = document.getElementById(e.id);
                if (!target) return;
                event.preventDefault();
                target.scrollIntoView({ block: "center" });
                target.focus();
              }}
            >
              {e.label}: {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
