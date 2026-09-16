import test from 'node:test';
import assert from 'node:assert/strict';
import {ReusableViews} from '../reusable-views.mjs';
test('shared retention supports another trusted adapter without weather-specific storage',()=>{
  // Test-only adapter; this does not claim a sports data integration is installed.
  const library=new ReusableViews({agenda:spec=>{if(Object.keys(spec).sort().join(',')!=='component,title'||spec.component!=='agenda')throw Error('invalid');}});
  const state={};const a=library.retain(state,{kind:'agenda',scope:'sports',spec:{title:'Games',component:'agenda'}},1);
  assert.equal(library.retain(state,{kind:'agenda',scope:'sports',spec:{component:'agenda',title:'Games'}},2).id,a.id);
  const b=library.retain(state,{kind:'agenda',scope:'sports',spec:{title:'Weekend games',component:'agenda'},parentId:a.id},3);
  assert.equal(b.parentId,a.id);assert.equal(state.reusableViews.length,2);
  assert.equal(a.data,undefined);assert.equal(a.actions,undefined);
  assert.throws(()=>library.retain(state,{kind:'shell',scope:'x',spec:{}}));
  assert.throws(()=>library.retain(state,{kind:'agenda',scope:'sports',spec:{title:'Bad',component:'agenda',code:'run'}}));
  assert.throws(()=>library.retain(state,{kind:'agenda',scope:'sports',spec:{title:'Bad',component:'agenda'},parentId:'missing'}));
});
