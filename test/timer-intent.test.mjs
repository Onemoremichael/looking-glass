import test from 'node:test';
import assert from 'node:assert/strict';
import {timerIntent,analyzeTimerIntent} from '../timer-intent.mjs';
test('timer accelerator accepts complete natural variants and compound durations',()=>{
  for(const [text,seconds] of [
    ['Can you set a timer for 30 seconds',30],['Please start a five-minute timer.',300],
    ['Could you please start me a timer for ninety seconds?',90],['Give me a 1.5 minute timer',90],
    ["I'd like a timer for one and a half minutes",90],['Put two minutes on the timer',120],
    ['Start a timer for one hour and twenty five minutes and thirty seconds',5130],
    ['Add another 30 second timer',30],['Set a timer for half an hour',1800],
    ['I need a timer for thirty-five seconds please',35],['Set a timer for 24 hours',86400],
  ])assert.deepEqual(timerIntent(text),{seconds,label:'Timer'},text);
});
test('conversational framing, countdowns and explicit in-turn corrections take the fast lane',()=>{
  for(const [text,seconds] of [
    [' Thanks. Now add a timer for thirty seconds',30],
    ['Thank you! Okay, could you please set a timer for 30 seconds for me?',30],
    ["Okay, let's start a five-minute countdown, please.",300],
    ['Would you mind setting a timer for two minutes?',120],
    ["I'd like you to go ahead and start me a timer for thirty seconds",30],
    ['Now give me five minutes',300],['Can I have a ninety second timer?',90],
    ['Start counting down from two minutes',120],['Count down for thirty seconds',30],
    ['Set thirty seconds—actually, make it a minute',60],
    ['Set a timer for 30 seconds, actually make it two minutes',120],
    ['Thanks, set a thirty second timer. Actually, make that one minute please',60],
  ])assert.deepEqual(timerIntent(text),{seconds,label:'Timer'},text);
});
test('framing never discards negation, earlier commands, quotation or unfinished corrections',()=>{
  for(const text of [
    "Thanks. Don't set a timer for thirty seconds",'Okay, do not start a five minute countdown',
    'Thanks but do nothing. Now set a timer for 30 seconds',
    'Clear the timer. Now add a timer for thirty seconds',
    'Say "set a timer for thirty seconds"','Thanks, if I set a timer for thirty seconds',
    'Okay, set thirty seconds or five minutes','Give me five minutes before you start',
    'Give me five minutes to think','Set a timer for thirty seconds, actually',
    'Set a timer for thirty seconds, actually make it','Set a timer for thirty seconds, actually make it a minute and cancel it',
    'Set a timer for thirty seconds, actually make it two or three minutes',
    "Don't set thirty seconds, actually make it a minute",'Set thirty seconds, actually make it a minute, actually make it two minutes',
    'Okay, set a timer for -5 seconds','Thanks, start a timer for thirty seconds tomorrow',
    'The screen says set a timer for thirty seconds','Starting a five minute timer',
  ])assert.equal(timerIntent(text),null,text);
});
test('fallback reasons are bounded categories, not user content',()=>{
  for(const [text,reason] of [
    ['Thanks. Now add a timer for thirty seconds','matched'],
    ['start a timer','missing_duration'],['set a timer for 30','unrecognized_duration'],
    ["don't set a timer for 30 seconds",'uncertain_language'],
    ['please arrange a timer lasting five minutes','unsupported_wording'],
    ['show my calendar','not_timer'],['cancel my milk todo','not_timer'],[null,'invalid_request'],
  ])assert.equal(analyzeTimerIntent(text).reason,reason,text);
});
test('timer accelerator never executes partial, negated, hypothetical, corrected or compound commands',()=>{
  for(const text of [
    'start a timer','set a timer for 30','Do not set a timer for 30 seconds',
    'Can you explain how to set a timer for 30 seconds', 'If I set a timer for 30 seconds',
    'Set a timer for 30 seconds, actually 40 seconds','Set a timer for two or three minutes',
    'Set a timer for two minutes and cancel it','Set a timer for two minutes and',
    'Set a timer for two minutes named eggs','Set a timer for 30 seconds tomorrow',
    'Set a timer for 0 seconds','Set a timer for -5 seconds','Set a timer for 25 hours',
    'Set a timer for two minutes three minutes','Set a timer for 0.1 seconds',
    'set a timer for 30 seconds. Add milk','Do nothing. Set a timer for 30 seconds',
  ])assert.equal(timerIntent(text),null,text);
});
