import crypto from "node:crypto";
import { stableStringify } from "../io/json.mjs";

export const VERIFICATION_PRODUCER = "makeitreal-engine verify";
export const BOARD_VERIFICATION_PRODUCER = "makeitreal-engine board-complete";

export function normalizeVerificationCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return {
      ok: false,
      reason: "Verification command must be an object with file and args fields."
    };
  }

  if (typeof command.file !== "string" || command.file.trim().length === 0) {
    return {
      ok: false,
      reason: "Verification command file must be a non-empty string."
    };
  }

  const args = command.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return {
      ok: false,
      reason: "Verification command args must be an array of strings."
    };
  }

  return {
    ok: true,
    command: {
      file: command.file,
      args
    }
  };
}

export function hashCommand(command) {
  const normalized = normalizeVerificationCommand(command);
  const value = normalized.ok ? normalized.command : command;
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function formatVerificationCommand(command) {
  const normalized = normalizeVerificationCommand(command);
  if (!normalized.ok) {
    return "<invalid verification command>";
  }
  return [normalized.command.file, ...normalized.command.args].join(" ");
}
