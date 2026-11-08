import { describe, expect, it } from "vitest";
import { keccak256, merkleLeaf, merkleNode, verifyProof, parseBytes32Array } from "../src/engine/keccak";
const A="0x"+"1".repeat(40), B="0x"+"2".repeat(40), C="0x"+"3".repeat(40), D="0x"+"4".repeat(40);
const leafB="0x526cad0af1dda06f7f5688e7b654b6d6395cb3904c818c16bb7b53fac7d1b881";
const leafD="0x70abacda97f1a3255e287fb4d34bc282953408c8635f75cd9f4d68defc498b57";
const ab="0x4c0e3b6731a0177b5c4e4ecbddf93f958476bd2f4958afb8e2d855984d869160", cd="0x7672f629b84ea7636bb85953a21640b26992fd0e41acddae02111ec9f3d59c07";
const root="0xba6e7cc2629ce6911cf1e06337a7a4ed024d02d87508cb223cbc875a1beffc54";
describe("Ethereum Keccak-256 vectors (Wave 3 §4)",()=>{
  it("empty and abc use Keccak domain, not SHA3",()=>{
    expect(keccak256(new Uint8Array())).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(keccak256(new TextEncoder().encode("abc"))).toBe("0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });
  it("leaves A-D, sorted nodes AB/CD and root",()=>{
    expect(merkleLeaf(A,100000000n)).toBe("0xb2e0f0f581f874685afedde23f11cfd90fe016ddd4c2212b3ed5252251c4e413");
    expect(merkleLeaf(C,75000000n)).toBe("0xb7fee512cfe67106d3cc98f0b7e8f0a72acb5e3b9d159fb46709b018f04f2ed6");
    expect(merkleLeaf(B,250000000n)).toBe(leafB); expect(merkleLeaf(D,500000000n)).toBe(leafD);
    expect(merkleNode(merkleLeaf(A,100000000n),leafB)).toBe(ab);
    expect(merkleNode(merkleLeaf(C,75000000n),leafD)).toBe(cd);
    expect(merkleNode(cd,ab)).toBe(root); expect(merkleNode(ab,cd)).toBe(root);
  });
  it("A/C proofs bind sender and amount",()=>{
    expect(verifyProof(A,100000000n,[leafB,cd],root)).toBe(true);
    expect(verifyProof(C,75000000n,[leafD,ab],root)).toBe(true);
    expect(verifyProof(C,75000000n,[leafB,cd],root)).toBe(false);
    expect(verifyProof(C,75000001n,[leafD,ab],root)).toBe(false);
  });
  it("bytes32[] absorbs prefix/whitespace and rejects malformed bytes",()=>{
    expect(parseBytes32Array(`  ${leafD.slice(2).toUpperCase()}\n\n ${ab} `)).toEqual([leafD,ab]);
    expect(parseBytes32Array("  ")).toEqual([]);
    expect(()=>parseBytes32Array("0x1234")).toThrow();
  });
});
