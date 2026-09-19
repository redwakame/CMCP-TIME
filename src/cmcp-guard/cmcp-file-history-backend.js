import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function storageError(code) {
  return Object.assign(new Error(code), { code });
}

/**
 * Immutable, create-only local reference backend. Keys are SHA-256 hex, not IDs.
 * No I/O at construction. See docs/local-durable-history-provider-v0.1.md.
 */
export function createCmcpFileHistoryBackend({ root }) {
  if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0")) {
    throw new TypeError("invalid_file_history_root");
  }
  const directory = path.resolve(root);
  function destination(key) {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
      throw new TypeError("invalid_file_history_key");
    }
    return path.join(directory, key + ".json");
  }
  return Object.freeze({
    descriptor: Object.freeze({ implementation: "local_file_reference", root: directory }),
    async listKeys() {
      try {
        const entries = await fs.readdir(directory);
        return entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => name.slice(0, -5)).sort();
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    async read(key) {
      try { return await fs.readFile(destination(key), "utf8"); }
      catch (error) {
        if (error.code === "ENOENT") {
          // Windows can report ENOENT when the configured root is a file.
          // Distinguish an absent store/key from an unusable root.
          try {
            if (!(await fs.stat(directory)).isDirectory()) throw storageError("HISTORY_ROOT_UNAVAILABLE");
          } catch (rootError) {
            if (rootError.code !== "ENOENT") throw rootError;
          }
          return null;
        }
        throw error;
      }
    },
    async create(key, data) {
      const target = destination(key);
      if (typeof data !== "string") throw new TypeError("invalid_file_history_data");
      await fs.mkdir(directory, { recursive: true });
      const pending = path.join(directory, ".pending-" + randomUUID());
      const handle = await fs.open(pending, "wx", 0o600);
      let failure;
      try {
        await handle.writeFile(data, "utf8");
        await handle.sync();
      } catch (error) { failure = error; }
      try { await handle.close(); }
      catch (error) { failure ??= error; }
      // Leave failed/incomplete writes for inspection; never publish or repair them.
      if (failure) throw failure;
      if (await fs.readFile(pending, "utf8") !== data) throw storageError("HISTORY_READBACK_MISMATCH");
      let status;
      try {
        // Atomic no-replace publication on a filesystem supporting hard links.
        // No rename/overwrite fallback on unsupported filesystems.
        await fs.link(pending, target);
        status = "created";
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        status = "exists";
      }
      // Only this call's fully prepared temporary link is eligible for release.
      // This is not a scan/retention policy; failed staging data stays untouched.
      let temporaryFileRetained = false;
      try { await fs.unlink(pending); }
      catch { temporaryFileRetained = true; }
      return Object.freeze({ status, temporaryFileRetained });
    }
  });
}
