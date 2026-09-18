import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundCommentary} from '../live-commentary.mjs';

test('background receipts are byte-bounded speakable summaries, never serialized artifacts',()=>{
  for(const message of ['Your research is ready.','A'.repeat(5000),'雨🌦️"\\\n'.repeat(500)]){
    const content=backgroundCommentary({status:'completed',message,researchArtifact:{private:'do not serialize'},code:'hidden'});
    assert.ok(Buffer.byteLength(content)<=480);
    const data=JSON.parse(content);
    assert.equal(data.result.status,'completed');assert.equal(data.kind,'background_result');
    assert.doesNotMatch(content,/private|serialize|hidden|researchArtifact/);
    assert.ok(!data.result.message.includes('\ufffd'));
  }
  assert.equal(JSON.parse(backgroundCommentary({status:'needs_input',message:'The source could not be checked.'})).result.message,'The source could not be checked.');
});
