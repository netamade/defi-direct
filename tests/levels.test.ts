import { expect, it } from "vitest";
import { levelForXp, LEVELS } from "../src/scoring/levels";
it("L1-L5を維持し、§6の案のL6-L8を境界どおり適用",()=>{
  expect(LEVELS.map(l=>l.minXp)).toEqual([0,100,250,450,700,1200,1900,2600]);
  for(const [xp,level] of [[1199,5],[1200,6],[1899,6],[1900,7],[2599,7],[2600,8],[2850,8]]) expect(levelForXp(xp!).current.level).toBe(level);
  expect(levelForXp(1200).xpToNext).toBe(700); expect(levelForXp(2850).next).toBeNull();
});
