import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// バックアップの暗号化（設計書 §6.5「補足」）。**公開鍵方式**にして、ジョブには公開鍵だけを渡す
// （復号の秘密鍵は、システムの所有者が Secret Manager とは別の場所に保管する）
//
// 方式: X25519 の使い捨ての鍵と受け取り手の公開鍵で共有の秘密を作り（ECDH）、HKDF で AES-256-GCM の鍵にする。
// 外部のコマンド（age など）には頼らない（コンテナに入れるものを増やさないため）。
// 形式: "BBP1" ＋ 使い捨ての公開鍵（32 バイト）＋ 初期化ベクトル（12 バイト）＋ 暗号文 ＋ 認証タグ（16 バイト）

const MAGIC = Buffer.from("BBP1", "ascii");
const RAW_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const INFO = Buffer.from("beachball-portal backup", "utf8");

// 公開鍵・秘密鍵は base64（DER。`BACKUP_ENCRYPTION_KEY` に公開鍵を入れる）
export type BackupKeyPair = { publicKey: string; privateKey: string };

export function generateBackupKeyPair(): BackupKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

function rawPublicKey(key: ReturnType<typeof createPublicKey>): Buffer {
  // SPKI の DER は末尾 32 バイトが生の公開鍵
  return key.export({ type: "spki", format: "der" }).subarray(-RAW_KEY_LENGTH);
}

function aesKey(shared: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), INFO, 32));
}

export function encryptForBackup(publicKeyBase64: string, data: Uint8Array | string): Uint8Array {
  const recipient = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", aesKey(shared), iv);
  const body = Buffer.concat([cipher.update(Buffer.from(data as Uint8Array)), cipher.final()]);
  return Buffer.concat([MAGIC, rawPublicKey(ephemeral.publicKey), iv, body, cipher.getAuthTag()]);
}

// 復号（復元の手順とテスト用。本番のジョブでは使わない）
export function decryptBackup(privateKeyBase64: string, container: Uint8Array): Uint8Array {
  const buffer = Buffer.from(container);
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("バックアップの形式が違います");
  const offset = MAGIC.length;
  const ephemeralRaw = buffer.subarray(offset, offset + RAW_KEY_LENGTH);
  const iv = buffer.subarray(offset + RAW_KEY_LENGTH, offset + RAW_KEY_LENGTH + IV_LENGTH);
  const body = buffer.subarray(offset + RAW_KEY_LENGTH + IV_LENGTH, buffer.length - TAG_LENGTH);
  const tag = buffer.subarray(buffer.length - TAG_LENGTH);

  // 生の公開鍵を SPKI の DER に戻す（先頭 12 バイトは X25519 の決まった並び）
  const spkiPrefix = Buffer.from("302a300506032b656e032100", "hex");
  const ephemeral = createPublicKey({ key: Buffer.concat([spkiPrefix, ephemeralRaw]), format: "der", type: "spki" });
  const privateKey = createPrivateKey({ key: Buffer.from(privateKeyBase64, "base64"), format: "der", type: "pkcs8" });
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });

  const decipher = createDecipheriv("aes-256-gcm", aesKey(shared), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
