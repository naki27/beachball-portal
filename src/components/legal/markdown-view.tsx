import Link from "next/link";
import type { Block, Inline } from "@/lib/legal/markdown";

// プライバシーポリシー・利用規約の表示（設計書 §5.18）。375px 幅で崩れないこと（表は横スクロール）
function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "strong" ? (
          <strong key={index} className="font-bold">
            {part.value}
          </strong>
        ) : part.kind === "link" ? (
          <Link key={index} href={part.href} className="underline underline-offset-2">
            {part.value}
          </Link>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  );
}

export function MarkdownView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const text = <InlineText parts={block.text} />;
          if (block.level === 1) return <h1 key={index} className="text-2xl font-bold">{text}</h1>;
          if (block.level === 2) return <h2 key={index} className="mt-4 text-lg font-bold">{text}</h2>;
          return <h3 key={index} className="mt-2 font-bold">{text}</h3>;
        }
        if (block.kind === "paragraph") {
          return (
            <p key={index} className="leading-relaxed break-words">
              <InlineText parts={block.text} />
            </p>
          );
        }
        if (block.kind === "list") {
          const className = `flex flex-col gap-2 pl-6 leading-relaxed ${block.ordered ? "list-decimal" : "list-disc"}`;
          const items = block.items.map((item, itemIndex) => (
            <li key={itemIndex} className="break-words">
              <InlineText parts={item} />
            </li>
          ));
          return block.ordered ? (
            <ol key={index} className={className}>
              {items}
            </ol>
          ) : (
            <ul key={index} className={className}>
              {items}
            </ul>
          );
        }
        return (
          <div key={index} className="overflow-x-auto">
            <table className="w-full min-w-xs border-collapse text-sm">
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex} className="border border-border px-2 py-2 text-left align-top font-semibold">
                      <InlineText parts={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border border-border px-2 py-2 align-top">
                        <InlineText parts={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
