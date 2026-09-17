#!/usr/bin/env bash
# 設計書（design.md）を「## 章」「### 節」ごとのファイルに分ける。
# AI エージェントに設計書を丸ごと読ませず、作業に必要な節だけを読ませるため。
#
# 使い方（リポジトリ直下で。Windows は Git Bash）:
#   bash tools/split-design.sh docs/design.md docs/design
# 設計書を更新したら、そのたびに再実行する（出力先の *.md は作り直す）。
#
# ファイル名: 00-header.md（版・変更履歴）、05-0.md（5 章の前書き）、05-11.md（§5.11）、appendix-a.md（付録 A）
set -euo pipefail

src="${1:-docs/design.md}"
out="${2:-docs/design}"

if [ ! -f "$src" ]; then
  echo "設計書が見つかりません: $src" >&2
  exit 1
fi

mkdir -p "$out"
rm -f "$out"/*.md

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

# コードブロック（``` で囲まれた範囲）の中の行は見出しとして扱わない
LC_ALL=C awk -v out="$out" -v manifest="$manifest" '
function flush(   path) {
  if (file != "" && content > 0) {
    path = out "/" file
    printf "%s", body > path
    close(path)
    printf "%s\t%s\n", file, title >> manifest
  }
  body = ""; content = 0
}
BEGIN { file = "00-header.md"; title = "冒頭（版・変更履歴。作業では読まない）"; body = ""; content = 0; infence = 0 }
/^```/ { infence = !infence }
!infence && /^## / {
  flush()
  title = substr($0, 4)
  if (match(title, /^[0-9]+\./)) {
    file = sprintf("%02d-0.md", substr(title, 1, RLENGTH - 1) + 0)
  } else if ($0 ~ /^## 付録 [A-Z]/) {
    letter = $0; sub(/^## 付録 /, "", letter)
    file = "appendix-" tolower(substr(letter, 1, 1)) ".md"
  } else {
    file = sprintf("misc-%03d.md", NR)
  }
  body = $0 "\n"
  next
}
!infence && /^### / {
  flush()
  title = substr($0, 5)
  if (match(title, /^[0-9]+\.[0-9]+/)) {
    split(substr(title, 1, RLENGTH), p, ".")
    file = sprintf("%02d-%d.md", p[1] + 0, p[2] + 0)
  } else {
    file = sprintf("misc-%03d.md", NR)
  }
  body = $0 "\n"
  next
}
{
  body = body $0 "\n"
  if ($0 ~ /[^[:space:]]/) content++
}
END { flush() }
' "$src"

# 付録 A（DDL）はさらにテーブルごとに分ける（appendix-a/<テーブル名>.md）
# テーブルの直前のコメント行は、そのテーブルのファイルに入れる
rm -rf "$out/appendix-a"
if [ -f "$out/appendix-a.md" ]; then
  mkdir -p "$out/appendix-a"
  LC_ALL=C awk -v dir="$out/appendix-a" '
  function emit(   path) {
    if (body != "") {
      path = dir "/" name ".md"
      printf "```sql\n%s```\n", body >> path
      close(path)
    }
    body = ""
  }
  BEGIN { name = "00-extensions"; body = ""; pending = ""; rls = 0 }
  /^```/ || /^## / { next }
  /^create (table|view) / {
    emit()
    name = $3; sub(/[^a-z_].*$/, "", name)
    sub(/^\n+/, "", pending)
    body = pending $0 "\n"; pending = ""
    next
  }
  /^insert into / && !rls { emit(); name = "zz-seed"; sub(/^\n+/, "", pending); body = pending $0 "\n"; pending = ""; next }
  /^-- =+/ { body = body pending; pending = ""; emit(); name = "zz-rls-and-functions"; rls = 1; body = $0 "\n"; next }
  /^--/ || /^[[:space:]]*$/ {
    if (rls) { body = body $0 "\n" } else { pending = pending $0 "\n" }
    next
  }
  { body = body pending $0 "\n"; pending = "" }
  END { body = body pending; emit() }
  ' "$out/appendix-a.md"
fi

# 見出しの一覧とサイズ（KB）を index.md に書く
kb() { awk -v b="$(wc -c < "$1")" 'BEGIN { printf "%.1f", b / 1024 }'; }
{
  echo "# 設計書の節の一覧"
  echo
  echo "元: \`$src\`（分割: \`bash tools/split-design.sh\`）。設計書を更新したら再実行する。"
  echo "作業では、タスクに書かれた節のファイルだけを読む。\`00-header.md\` と \`14-*.md\`（決定の記録）は、指示がなければ読まない。"
  echo
  echo "| ファイル | 見出し | KB |"
  echo "|---|---|---|"
  while IFS=$'\t' read -r f t; do
    echo "| \`$f\` | $t | $(kb "$out/$f") |"
  done < "$manifest"
  if [ -d "$out/appendix-a" ]; then
    echo
    echo "## 付録 A（DDL）のテーブルごとのファイル"
    echo
    echo "テーブルを作る作業では \`appendix-a.md\` 全体ではなく、こちらの必要なファイルだけを読む。"
    echo
    echo "| ファイル | KB |"
    echo "|---|---|"
    for f in "$out"/appendix-a/*.md; do
      echo "| \`appendix-a/$(basename "$f")\` | $(kb "$f") |"
    done
  fi
} > "$out/index.md"

count=$(wc -l < "$manifest")
tables=$(ls "$out"/appendix-a/*.md 2>/dev/null | wc -l)
echo "分割しました: 節 $count ファイル、付録 A のテーブル $tables ファイル → $out（一覧は $out/index.md）"
