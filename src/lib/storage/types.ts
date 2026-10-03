// ファイルの保存先の差し替え口（設計書 §5.9・§6.3）
//   local … `.local-storage/{private,public,backup}/`（ローカル。R2 は本番だけ）
//   r2    … Cloudflare R2（S3 互換 API）。実際につながることは X-01 で確かめる
// バケットは 3 つに分ける（§6.5「補足」）:
//   private … 大会資料の原本（保管用）
//   public  … 公開用（推測されにくい名前で配信する）
//   backup  … DB と申込一覧 CSV のバックアップ。**暗号化してから置く**（全員の生年月日を含むため）

export type StorageBucket = "private" | "public" | "backup";

export type PutOptions = {
  contentType?: string;
  // 公開用のファイルに付ける（ブラウザ内で開き、保存時の名前を決める・§5.9）
  contentDisposition?: string;
  // 公開用のファイルのキャッシュの長さ（Cloudflare・§5.9）
  cacheControl?: string;
};

// 置いたファイルに付いている情報（中身は読まない）。pnpm storage:check が公開用のヘッダを確かめるのに使う
export type StorageObjectMeta = {
  contentType: string | null;
  contentDisposition: string | null;
  cacheControl: string | null;
  size: number | null;
};

export type StorageAdapter = {
  readonly driver: "local" | "r2";
  put(bucket: StorageBucket, key: string, body: Uint8Array, options?: PutOptions): Promise<void>;
  get(bucket: StorageBucket, key: string): Promise<Uint8Array | null>;
  // 中身を読まずに付いている情報だけを取る。なければ null
  head(bucket: StorageBucket, key: string): Promise<StorageObjectMeta | null>;
  remove(bucket: StorageBucket, key: string): Promise<void>;
  list(bucket: StorageBucket, prefix: string): Promise<string[]>;
  // 公開用のファイルの URL（PUBLIC_FILES_BASE_URL。ローカルは開発時だけのルート・§5.9）
  publicUrl(key: string): string;
};

// キーに使えるのは英数字と - _ . /（`..` は不可）。保存先の外に書き出さないため
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertStorageKey(key: string): void {
  if (!KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("保存先の名前に使えない文字が入っています");
  }
}
