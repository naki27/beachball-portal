#!/usr/bin/env bash
# GCP の初期設定（設計書 §6.3・§6.5.1・§6.6・X-02）。**人が手元の PC で 1 回実行する**
# 何度流しても同じ結果になる（すでにあるものは作らない・設定だけ合わせる）
#
#   gcloud auth login
#   PROJECT_ID=xxx bash tools/gcp-bootstrap.sh
#
# 識別子はこのファイルに書かない（リポジトリは公開なので・docs/p1-tasks.md）。環境変数か引数で渡す。
# **Secret の「器」だけを作り、値は入れない**。値を入れる手順は docs/ops.md §11
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${1:-}}"
if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID を渡してください（例: PROJECT_ID=my-project bash tools/gcp-bootstrap.sh）" >&2
  exit 1
fi

REGION="${REGION:-asia-southeast1}"
REPOSITORY="${REPOSITORY:-beachball}"
SERVICE="${SERVICE:-beachball-portal}"
GITHUB_REPO="${GITHUB_REPO:-naki27/beachball-portal}"
POOL="${POOL:-github}"
PROVIDER="${PROVIDER:-github-actions}"
# Artifact Registry に残すイメージの数（無料枠 0.5 GB・§6.5.1）
KEEP_IMAGES="${KEEP_IMAGES:-5}"

echo "プロジェクト: ${PROJECT_ID} / リージョン: ${REGION} / GitHub: ${GITHUB_REPO}"

gcloud() { command gcloud --project "${PROJECT_ID}" --quiet "$@"; }

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

# ---- 1. API を有効にする
echo "== API"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com

# ---- 2. Artifact Registry（イメージの置き場所）と、古いイメージを消すルール
echo "== Artifact Registry"
if ! gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker --location "${REGION}" \
    --description="beachball-portal のコンテナイメージ"
fi

policy_file="$(mktemp)"
trap 'rm -f "${policy_file}"' EXIT
cat >"${policy_file}" <<JSON
[
  {
    "name": "keep-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": ${KEEP_IMAGES} }
  },
  {
    "name": "delete-old",
    "action": { "type": "Delete" },
    "condition": { "tagState": "ANY", "olderThan": "30d" }
  }
]
JSON
gcloud artifacts repositories set-cleanup-policies "${REPOSITORY}" \
  --location "${REGION}" --policy="${policy_file}" --no-dry-run

# ---- 3. サービスアカウント（渡す先ごとに分ける・§6.3「使うサービスにだけ」）
echo "== サービスアカウント"
declare -A ACCOUNTS=(
  [deployer]="GitHub Actions からのデプロイ"
  [app]="Cloud Run のアプリ"
  [job-mail]="メール送信のジョブ"
  [job-daily]="日次ジョブ"
  [migrate]="マイグレーションの Job"
)
sa_email() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }

for name in "${!ACCOUNTS[@]}"; do
  if ! gcloud iam service-accounts describe "$(sa_email "${name}")" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${name}" --display-name "${ACCOUNTS[$name]}"
  fi
done

# ---- 4. デプロイ用の権限（イメージの書き込み・Cloud Run の更新・ジョブの実行だけ）
echo "== デプロイ用の権限"
add_project_role() {
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:$(sa_email "$1")" --role "$2" --condition=None >/dev/null
}
add_project_role deployer roles/artifactregistry.writer
# リビジョンの作成・トラフィックの切り替え・Job の実行（§6.6 の手順 2〜5）
add_project_role deployer roles/run.admin
# 「このサービスアカウントとして動かす」ために要る（アプリ・ジョブの実行アカウントを指定するため）
for name in app job-mail job-daily migrate; do
  gcloud iam service-accounts add-iam-policy-binding "$(sa_email "${name}")" \
    --member "serviceAccount:$(sa_email deployer)" --role roles/iam.serviceAccountUser >/dev/null
done

# ---- 5. Workload Identity Federation（鍵ファイルなしで GitHub Actions から入る）
echo "== Workload Identity Federation"
if ! gcloud iam workload-identity-pools describe "${POOL}" --location global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL}" --location global --display-name "GitHub Actions"
fi
# **このリポジトリの main だけ**を通す（他のブランチ・他のリポジトリからは入れない）
condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.ref_type == 'branch'"
if gcloud iam workload-identity-pools providers describe "${PROVIDER}" \
     --location global --workload-identity-pool "${POOL}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER}" \
    --location global --workload-identity-pool "${POOL}" \
    --attribute-condition="${condition}" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" \
    --location global --workload-identity-pool "${POOL}" \
    --display-name "GitHub Actions" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-condition="${condition}" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
fi

POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
gcloud iam service-accounts add-iam-policy-binding "$(sa_email deployer)" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" >/dev/null

# ---- 6. Secret の器（値は入れない）と、使うサービスだけへの読み取り権限
echo "== Secret"
# 「Secret の名前 : 読めるサービスアカウント（空白区切り）」。docs/ops.md §9 の表と同じ
SECRETS=(
  "DATABASE_URL:app"
  "MIGRATION_DATABASE_URL:migrate"
  "JOB_DATABASE_URL:job-mail job-daily"
  "BACKUP_DATABASE_URL:job-daily"
  "SESSION_SECRET:app"
  "LOGIN_CODE_HMAC_KEY:app"
  "MAIL_API_KEY:app job-mail"
  "BREVO_WEBHOOK_TOKEN:app"
  "BACKUP_ENCRYPTION_KEY:job-daily"
  "R2_ACCESS_KEY_ID:app job-daily"
  "R2_SECRET_ACCESS_KEY:app job-daily"
  "R2_BACKUP_ACCESS_KEY_ID:job-daily"
  "R2_BACKUP_SECRET_ACCESS_KEY:job-daily"
)
for entry in "${SECRETS[@]}"; do
  secret="${entry%%:*}"
  readers="${entry#*:}"
  if ! gcloud secrets describe "${secret}" >/dev/null 2>&1; then
    gcloud secrets create "${secret}" --replication-policy=automatic
    echo "  ${secret}: 器を作った（値は docs/ops.md §11 の手順で入れる）"
  fi
  for reader in ${readers}; do
    gcloud secrets add-iam-policy-binding "${secret}" \
      --member "serviceAccount:$(sa_email "${reader}")" \
      --role roles/secretmanager.secretAccessor >/dev/null
  done
done

cat <<INFO

== 終わり。GitHub の Environment「production」の Variables に入れる値 ==
  GCP_PROJECT_ID          ${PROJECT_ID}
  GCP_REGION              ${REGION}
  GCP_REPOSITORY          ${REPOSITORY}
  CLOUD_RUN_SERVICE       ${SERVICE}
  WIF_PROVIDER            ${POOL_ID}/providers/${PROVIDER}
  DEPLOYER_SERVICE_ACCOUNT $(sa_email deployer)
  APP_SERVICE_ACCOUNT     $(sa_email app)
  MIGRATE_SERVICE_ACCOUNT $(sa_email migrate)

次は docs/ops.md §11（Secret に値を入れる）→ §12（初回のデプロイ）。
定期ジョブ（job-mail・job-daily）と Cloud Scheduler は X-03（tools/gcp-jobs.sh）。
INFO
