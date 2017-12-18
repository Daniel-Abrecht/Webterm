"use strict";

var ereg = new Map();

function registerElement(func){
  for( var e of Array.from(document.getElementsByClassName(func.name)) ){
    if(e.controller)
      continue;
    e.controller = new func(e);
  }
  ereg.set(name,func);
}
