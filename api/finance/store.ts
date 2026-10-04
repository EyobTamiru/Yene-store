/**
 * ============================================================================
 *  FINANCE DATA STORE
 * ============================================================================
 *
 *  One durable JSON collection per aggregate, under `YENE_DATA_DIR` (or
 *  ./data), reusing api/lib/jsonCollection.ts so the write strategy - atomic,
 *  coalesced, fail-safe - is SHARED rather than reimplemented. This is the
 *  exact convention api/platform/store.ts follows.
 *
 *  ADDITIVE, AND THAT IS THE WHOLE POINT
 *  ------------------------------------
 *  Enabling the financial system creates NEW files. It does not open, rewrite,
 *  migrate or truncate any existing collection. `platform-products.json`,
 *  `platform-customers.json`, `platform-orders` and every other file the
 *  marketplace already depends on are not even imported by this module, so
 *  there is no code path from here to them.
 *
 *  In line with the project's instruction not to reset or recreate the
 *  production database, there is no migration step and no destructive command:
 *  the collections appear the first time a wallet is read, and an empty file is
 *  a valid starting state. Nothing here can delete a row.
 *
 *  SINGLE-WRITER, like every other store in this project. Documented in
 *  api/lib/jsonCollection.ts and unchanged by this work.
 *
 *  WHY WALLET TOTALS ARE A CACHE AND NOT A TRUTH
 *  --------------------------------------------
 *  `Wallet.totals` exists so the transaction history can render without
 *  replaying the ledger on every read. It is recomputable by replay, and
 *  `rebuildWallet` in the service layer does exactly that. A divergence
 *  between the cache and the ledger is a bug to surface, never a balance to
 *  trust - which is why the totals live beside the ledger rather than instead
 *  of it.
 */

import path from "node:path";
import { createJsonCollection } from "../lib/jsonCollection";
import type { LedgerTransaction, Wallet } from "../../src/finance/types";

const dataDir = process.env.YENE_DATA_DIR ?? path.resolve(process.cwd(), "data");

function collection<T>(file: string, label: string, limit = 20_000) {
  return createJsonCollection<T>(path.join(dataDir, file), label, limit);
}

/**
 * Wallets.
 *
 * Capped at 20,000, matching the auth and session stores. A wallet is created
 * lazily on first read, so this ceiling is reached only by an account count
 * that large.
 */
const wallets = collection<Wallet>("finance-wallets.json", "finance-wallets");

/**
 * The immutable ledger.
 *
 * A 50,000 cap, the same as the login-token store, and raised rather than
 * lowered deliberately: this is the append-only record of every movement, and
 * trimming it is the one thing that must never happen casually. The real
 * protection is that nothing in the codebase calls `flush` with a deletion - the
 * collection only ever grows through `push`.
 */
const ledger = collection<LedgerTransaction>("finance-ledger.json", "finance-ledger", 50_000);

export const allWallets = wallets.all;
export const allLedgerTransactions = ledger.all;

export const persistWallets = wallets.touch;
export const persistLedger = ledger.touch;

/** Force both stores to disk. Used by the verification suites. */
export function flushFinanceStores(): void {
  wallets.flush();
  ledger.flush();
}
