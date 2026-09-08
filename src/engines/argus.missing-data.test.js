import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecognition } from './argus.js';

const snapshot = metrics => ({status:'PARTIAL',raw_payload:{recognitionMetrics:metrics}});
// Synthetic integrity fixtures only; these tests make no alpha claim.
for (const value of [null, undefined, '', ' ', false, true, [], {}, NaN, Infinity]) {
  test('missing or invalid recognition values remain UNMEASURED: '+String(value), () => {
    const result=evaluateRecognition(snapshot({current5dReturnZ:value,current5dVolumeZ:value}));
    assert.equal(result.state,'UNMEASURED');
    assert.equal(result.basis.current5dReturnZ,null);
    assert.equal(result.basis.current5dVolumeZ,null);
  });
}
for (const [r,v,state] of [[0,0,'GREEN'],['0','0','GREEN'],[1,0,'YELLOW'],[2,0,'RED'],[null,2,'RED']]) {
  test('valid observations retain existing classification '+JSON.stringify([r,v]), () => {
    assert.equal(evaluateRecognition(snapshot({current5dReturnZ:r,current5dVolumeZ:v}),{yellowZ:1,redZ:2}).state,state);
  });
}
