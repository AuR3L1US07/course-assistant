const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {__fontTest:{parseTtfGlyphHashes}}=require('../browser_worker.cjs');

// Minimal TrueType fixture: one contour, with a nonzero bbox that the old
// monotonicity heuristic mistakenly interpreted as contour endpoints.
const font=Buffer.alloc(172);
font.writeUInt32BE(0x00010000,0);
font.writeUInt16BE(4,4);
for(const [i,[tag,offset,length]] of [['head',76,54],['maxp',130,6],['loca',136,8],['glyf',144,28]].entries()){
  font.write(tag,12+16*i);
  font.writeUInt32BE(offset,20+16*i);
  font.writeUInt32BE(length,24+16*i);
}
font.writeInt16BE(1,126); // head.indexToLocFormat
font.writeUInt16BE(1,134); // maxp.numGlyphs
font.writeUInt32BE(28,140); // loca end
// Header: contour count, xMin, yMin, xMax, yMax; then endpoint/instruction count.
[1,1,1,5,5,2,0].forEach((v,i)=>font.writeInt16BE(v,144+2*i));
font[158]=9; font[159]=2; // on-curve flag repeated for three points
[1,4,0,1,0,4].forEach((v,i)=>font.writeInt16BE(v,160+2*i));
const expected=crypto.createHash('md5').update('111511551').digest('hex');
assert.equal(parseTtfGlyphHashes(font)[0],expected);
console.log('TrueType mandatory bounding-box header regression passed');
