import test from 'node:test';
import assert from 'node:assert/strict';
import {gatorsBoard,parseSchedule,sports} from '../gators-schedule.mjs';
import {validateDecision} from '../assistant-contract.mjs';
import pages from '../public/research-pages.cjs';
const row=(date,at='Home',opponent='Opponent',time='6 p.m.',venue='Gainesville, FL (Stadium)',result=' -')=>'<tr>'+[date,time,at,opponent,venue,'',result].map(s=>'<td>'+s+'</td>').join('')+'</tr>';
const page=(rows,season='2026')=>'<h1>'+season+' Schedule</h1><table><thead><tr><th>At</th></tr></thead><tbody>'+rows+'</tbody></table>';
test('official table parser preserves home designation and ignores completed or cancelled events',()=>{
 const p=parseSchedule(page(row('Sep 23 (Wed)')+row('Sep 24 (Thu)','Away')+row('Sep 25 (Fri)','Neutral')+row('Sep 26 (Sat)','Home','Finished','6 PM',undefined,'W 2-0')+row('Sep 27 (Sun)','Home','Cancelled')),'womens-soccer');
 assert.equal(p.events.length,1);assert.equal(p.events[0].date,'2026-09-23');assert.equal(p.events[0].sport,"Women's Soccer");assert.equal(p.events[0].minute,1080);
 assert.throws(()=>parseSchedule('<html>Unavailable</html>','football'),/format/);
 assert.throws(()=>parseSchedule(page('<tr><td>x</td></tr>'),'football'),/columns/);
 assert.equal(parseSchedule(page(row('Jan 5 (Tue)'),'2026-27'),'mens-basketball').events[0].date,'2027-01-05');
});
test('Gainesville retrieval checks every sport and filters rolling dates using Eastern local time',async()=>{
 const called=[];
 const board=await gatorsBoard({now:Date.parse('2026-09-18T03:00:00Z'),read:async url=>{
  called.push(url);return {url,text:page(url.includes('/football/')?row('Sep 26 (Sat)','Home','Ole Miss','3:30 p.m.')+row('Sep 17 (Thu)')+row('Oct 2 (Fri)')+row('Sep 25 (Fri)','Away'):url.includes('/womens-soccer/')?row('Sep 24 (Thu)','Home','Texas'):'' )};
 }});
 assert.equal(called.length,sports.length);assert.equal(board.cards.length,2);
 assert.match(board.cards[0].heading,/Soccer · Texas/);assert.match(board.cards[1].heading,/Football · Ole Miss/);
 assert.match(board.summary,/2026-09-17 – 2026-10-01/);assert.match(board.cards[1].detail,/not confirmed/);
 validateDecision({status:'execute',outcome:'Home events',message:'Ready',actions:[{action:'compose_research',board}],options:[],selectedOptionId:null});
});
test('partial failures disclose coverage; complete failure never publishes a no-events result',async()=>{
 const read=async url=>{if(!url.includes('/football/'))throw Error('Unavailable');return {url,text:page('')};};
 const board=await gatorsBoard({read});assert.match(board.caveat,/Unavailable schedules/);assert.match(board.cards[0].body,/not a guarantee/);assert.equal(board.sources[0].id,'football');
 await assert.rejects(gatorsBoard({read:async()=>{throw Error('Unavailable');}}),/unavailable/);
});
test('agendas retain more than six events and restore old page indices to one all-events page',async()=>{
 const board=await gatorsBoard({now:Date.parse('2026-09-18T03:00:00Z'),read:async url=>({url,text:page(url.includes('/football/')?Array.from({length:9},(_,i)=>row('Sep '+(19+i)+' (Sat)','Home','Opponent '+i)).join(''):'')})});
 assert.equal(board.cards.length,9);board.page=1;
 assert.equal(pages.current(board).total,1);assert.equal(pages.current(board).index,0);assert.equal(pages.current(board).page.cardNumbers.length,9);
 delete board.page;
 validateDecision({status:'execute',outcome:'Home events',message:'Ready',actions:[{action:'compose_research',board}],options:[],selectedOptionId:null});
});
