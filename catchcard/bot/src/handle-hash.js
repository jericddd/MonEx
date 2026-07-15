import { keccak256, toBytes } from "viem";

export function xHandleHash(handle) {
  const normalized = String(handle || "").trim().replace(/^@/, "").toLowerCase();
  return keccak256(toBytes(normalized));
}
