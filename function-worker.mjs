// Trusted worker harness. Generated JS executes only inside QuickJS WebAssembly,
// never Node eval/vm. No host functions, module loader, filesystem or network API
// are installed in its context. Parent termination backs up guest CPU limits.
import {parentPort,workerData} from 'node:worker_threads';
import {newQuickJSWASMModule} from 'quickjs-emscripten';
try{
  const module=await newQuickJSWASMModule(),results=[];
  for(const input of workerData.inputs){
    const runtime=module.newRuntime();runtime.setMemoryLimit(16*1024*1024);runtime.setMaxStackSize(512*1024);
    const deadline=Date.now()+100;runtime.setInterruptHandler(()=>Date.now()>deadline);
    const context=runtime.newContext();
    try{
      const program=`(function(){"use strict";
        const encode=JSON.stringify, decode=JSON.parse;
        globalThis.Date=undefined; Math.random=undefined;
        const fn=(${workerData.code});
        if(typeof fn!=="function")throw Error("Expected function");
        const result=fn(decode(${JSON.stringify(JSON.stringify(input))}));
        if(result&&typeof result.then==="function")throw Error("Async is not supported");
        const output=encode(result);
        if(typeof output!=="string"||output.length>12000)throw Error("Output limit");
        return output;
      })()`;
      const value=context.evalCode(program);
      if(value.error){value.error.dispose();throw Error('Guest rejected');}
      try{results.push(JSON.parse(context.getString(value.value)));}finally{value.value.dispose();}
    }finally{context.dispose();runtime.dispose();}
  }
  parentPort.postMessage({ok:true,results});
}catch{parentPort.postMessage({ok:false});}
