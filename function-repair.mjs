import {isDeepStrictEqual} from 'node:util';
import {FunctionCheckError} from './custom-functions.mjs';

// A repair is one new, normally budgeted planning turn, not an unbounded retry.
// Only execution failures from the trusted checker qualify. Input, persistence,
// provider, cancellation, library-full and existing-recipe failures do not.
export function canRepairFunction(action,error){
  return action.action==='create_function'&&error instanceof FunctionCheckError&&
    ['runtime_rejected','output_contract','example_mismatch'].includes(error.diagnostic?.check);
}
export function functionRepairContext(action,error){
  return {customFunctions:{available:true,pureOnly:true,testsRequired:true,noNetworkOrDeviceAccess:true},
    functionRepair:{attempt:1,original:structuredClone(action),diagnostic:structuredClone(error.diagnostic)}};
}
export function validateFunctionRepair(original,decision){
  const candidate=decision?.actions?.[0];
  if(decision?.status!=='execute'||decision.actions.length!==1||candidate?.action!=='create_function'||
    typeof candidate.spec?.code!=='string'||candidate.spec.code===original.spec.code||
    !isDeepStrictEqual({...candidate,spec:{...candidate.spec,code:original.spec.code}},original)){
    throw Object.assign(Error('Function repair changed the requested contract or did not repair the code'),{code:'function_repair_invalid'});
  }
  return candidate;
}
