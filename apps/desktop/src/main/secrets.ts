// Secrets (the AI key) encrypted by the operating system: Windows DPAPI, macOS Keychain (Electron safeStorage).
// The window can store or delete a secret, never read it back.
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { secrets } from "./db/schema";

export interface Cipher {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class SecretStore {
  constructor(private db: Db, private cipher: Cipher) {}

  canEncrypt(): boolean {
    return this.cipher.available();
  }

  set(name: string, value: string): void {
    if (!this.cipher.available()) throw new Error("Szyfrowanie systemowe jest niedostępne, więc klucz nie zostanie zapisany.");
    const row = { name, value: this.cipher.encrypt(value).toString("base64"), updatedAt: new Date().toISOString() };
    this.db.insert(secrets).values(row).onConflictDoUpdate({ target: secrets.name, set: row }).run();
  }

  get(name: string): string | undefined {
    const row = this.db.select().from(secrets).where(eq(secrets.name, name)).get();
    if (!row || !this.cipher.available()) return undefined;
    try {
      return this.cipher.decrypt(Buffer.from(row.value, "base64"));
    } catch {
      return undefined; // e.g. the database was copied to another computer: the key must be entered again
    }
  }

  has(name: string): boolean {
    return !!this.db.select().from(secrets).where(eq(secrets.name, name)).get();
  }

  delete(name: string): void {
    this.db.delete(secrets).where(eq(secrets.name, name)).run();
  }
}

/** The real cipher, from Electron. Imported lazily so tests can run without Electron. */
export async function electronCipher(): Promise<Cipher> {
  const { safeStorage } = await import("electron");
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  };
}
