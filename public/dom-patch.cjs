(function(root){
  // Trusted, escaped renderer output only. This is reconciliation, not a sanitizer.
  // ES5 + ordinary DOM APIs: the physical mirror runs an older Android WebView.
  function text(el,value){value=String(value);if(el&&el.textContent!==value)el.textContent=value;}
  function attr(el,name,value){value=String(value);if(el.getAttribute(name)!==value)el.setAttribute(name,value);}
  function key(node){
    if(node.nodeType!==1)return '';
    var names=['data-render-key','id','data-clock-tile','data-calendar','data-panel','data-style','data-accent','data-weather-place','data-weather-remove','data-answer','data-fork','data-workflow-inputs','data-workflow-reply'];
    for(var i=0;i<names.length;i++)if(node.hasAttribute(names[i]))return names[i]+':'+node.getAttribute(names[i]);
    return '';
  }
  function same(a,b){return a.nodeType===b.nodeType&&a.nodeName===b.nodeName&&a.namespaceURI===b.namespaceURI&&key(a)===key(b);}
  function owned(node,name,options){
    var tag=node.nodeName.toLowerCase();
    // A state broadcast must not erase a draft or close an expanded disclosure.
    if(tag==='details'&&name==='open')return true;
    if(/^(input|textarea|select|option)$/.test(tag)&&/^(value|checked|selected)$/.test(name))return true;
    // Pausing a mechanism freezes its current pose, not its construction pose.
    if(options.clock&&node.hasAttribute('data-motion')&&(name==='transform'||name==='d'))return true;
    if(options.motion&&node.hasAttribute('data-folio-hand')&&name==='transform')return true;
    if(options.motion&&node.hasAttribute('data-clock-hand')&&name==='transform')return true;
    return false;
  }
  function update(node,next,options){
    if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;return;}
    // An ancestor render invalidates a nested renderer's cached input.
    node._glassMarkup=undefined;
    var attrs=Array.prototype.slice.call(node.attributes),i,a;
    for(i=0;i<attrs.length;i++){a=attrs[i];if(!next.hasAttribute(a.name)&&!owned(node,a.name,options))node.removeAttributeNS(a.namespaceURI,a.localName);}
    attrs=next.attributes;
    for(i=0;i<attrs.length;i++){a=attrs[i];if(!owned(node,a.name,options)&&node.getAttribute(a.name)!==a.value){
      if(a.namespaceURI)node.setAttributeNS(a.namespaceURI,a.name,a.value);else node.setAttribute(a.name,a.value);
    }}
    // These children are locally owned, not empty placeholders to reapply.
    if(node.nodeName.toLowerCase()==='textarea'||node.hasAttribute('data-end'))return;
    children(node,next,options);
  }
  function children(parent,next,options){
    var wanted=Array.prototype.slice.call(next.childNodes),cursor=parent.firstChild;
    for(var i=0;i<wanted.length;i++){
      var target=wanted[i],match=null,k=key(target),scan;
      if(cursor&&same(cursor,target))match=cursor;
      else if(k){for(scan=cursor;scan;scan=scan.nextSibling)if(same(scan,target)){match=scan;break;}}
      if(match){if(match!==cursor)parent.insertBefore(match,cursor);update(match,target,options);cursor=match.nextSibling;}
      else parent.insertBefore(target.cloneNode(true),cursor);
    }
    while(cursor){var old=cursor;cursor=cursor.nextSibling;parent.removeChild(old);}
  }
  function patch(el,html,options){
    if(el._glassMarkup===html)return;
    options=options||{};
    var fragment=el.ownerDocument.createElement('div');fragment.innerHTML=html;
    // Different panels must not inherit each other's controls/drafts. Explicit
    // keys (e.g. timers) deliberately survive panel changes and inserted cards.
    if(options.scope){for(var child=fragment.firstChild,index=0;child;child=child.nextSibling,index++){
      if(child.nodeType===1&&!child.hasAttribute('data-render-key'))child.setAttribute('data-render-key',options.scope+':'+(child.id||child.getAttribute('class')||child.nodeName+index));
    }}
    children(el,fragment,options);el._glassMarkup=html;
  }
  var api={patch:patch,text:text,attr:attr};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GlassDOM=api;
}(typeof window==='undefined'?globalThis:window));
