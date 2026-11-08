// Keccak-256 (Ethereum): Keccak-f[1600], rate 1088, legacy domain suffix 0x01.
// Small dependency-free implementation; all lanes are unsigned 64-bit BigInts.
const MASK = (1n << 64n) - 1n;
const ROT = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const RC = [0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
const rot = (v: bigint, n: number) => ((v << BigInt(n)) | (v >> BigInt(64-n))) & MASK;
function permute(a: bigint[]): void {
  for (const rc of RC) {
    const c=Array.from({length:5},(_,x)=>a[x]!^a[x+5]!^a[x+10]!^a[x+15]!^a[x+20]!);
    const d=c.map((_,x)=>c[(x+4)%5]!^rot(c[(x+1)%5]!,1));
    for(let i=0;i<25;i++) a[i]=a[i]!^d[i%5]!;
    const b=Array<bigint>(25).fill(0n);
    for(let x=0;x<5;x++) for(let y=0;y<5;y++) b[y+5*((2*x+3*y)%5)]=rot(a[x+5*y]!,ROT[x+5*y]!);
    for(let x=0;x<5;x++) for(let y=0;y<5;y++) a[x+5*y]=b[x+5*y]!^((~b[(x+1)%5+5*y]!)&b[(x+2)%5+5*y]!);
    a[0]=a[0]!^rc;
  }
}
export function hexBytes(hex: string): Uint8Array {
  const h=hex.replace(/^0x/i,"");
  if(!/^(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error("Invalid hex bytes");
  return Uint8Array.from(h.match(/../g)??[],v=>parseInt(v,16));
}
export function keccak256(input: Uint8Array): string {
  const rate=136, padded=new Uint8Array(Math.ceil((input.length+1)/rate)*rate);
  padded.set(input); padded[input.length]=1; padded[padded.length-1]!|=0x80;
  const a=Array<bigint>(25).fill(0n);
  for(let offset=0;offset<padded.length;offset+=rate) {
    for(let i=0;i<rate;i++) a[Math.floor(i/8)]=a[Math.floor(i/8)]!^(BigInt(padded[offset+i]!)<<BigInt((i%8)*8));
    permute(a);
  }
  return '0x'+Array.from({length:32},(_,i)=>Number((a[Math.floor(i/8)]!>>BigInt((i%8)*8))&255n).toString(16).padStart(2,'0')).join('');
}
export function merkleLeaf(address: string, amount: bigint): string {
  if(!/^0x[0-9a-f]{40}$/i.test(address)||amount<0n||amount>=(1n<<256n)) throw new Error("Invalid Merkle leaf");
  return keccak256(hexBytes(address+amount.toString(16).padStart(64,'0')));
}
export function merkleNode(a: string,b: string): string {
  if(!/^0x[0-9a-f]{64}$/i.test(a)||!/^0x[0-9a-f]{64}$/i.test(b)) throw new Error("Invalid Merkle node");
  const [lo,hi]=[a.toLowerCase(),b.toLowerCase()].sort();
  return keccak256(hexBytes(lo!+hi!.slice(2)));
}
export function verifyProof(address: string, amount: bigint, proof: string[], root: string): boolean {
  try { return proof.reduce(merkleNode,merkleLeaf(address,amount))===root.toLowerCase(); } catch { return false; }
}
/** UI accepts newline/space separated bytes32, with optional 0x. */
export function parseBytes32Array(input: string): string[] {
  if(!input.trim()) return [];
  return input.trim().split(/\s+/).map(s=>{
    const h=s.replace(/^0x/i,'');
    if(!/^[0-9a-f]{64}$/i.test(h)) throw new Error("proofは32バイトの16進数を改行区切りで入力してください。");
    return '0x'+h.toLowerCase();
  });
}
