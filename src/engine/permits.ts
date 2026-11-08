import type { Address } from "./state";
/** Educational signature data, not a real EIP-712 signature. Deadline is display only. */
export interface PermitRequest {
  id: string;
  owner: Address;
  spender: Address;
  spenderLabel: string;
  value: string;
  nonce: number;
  deadline: string;
  origin: string;
  hostile?: boolean;
}
export interface PermitDefinition {
  token: Address;
  preSigned: PermitRequest[];
  ownRequest: PermitRequest;
}
/** Session-only signing evidence. Never serialized to localStorage. */
export interface SignatureRecord {
  type: "sign";
  functionName: "signPermit";
  attemptId: number;
  sequence: number;
  contract: Address;
  args: Record<string, string>;
}
