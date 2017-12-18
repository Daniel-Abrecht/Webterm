"use strict";

class WSterm extends Webterm {
  constructor(root){
    super(root);
    this.ws = {};
    this.addr = null;
    this.service = null;
    if(this.root.dataset.url || this.root.dataset.service)
      this.connect(this.root.dataset.url,this.root.dataset.service);
    var that = this;
    this.outstream = {
      write(x){
        if(that.ws.readyState != WebSocket.OPEN)
          return;
        that.ws.send(':'+x);
      },
      resize(columns,rows){
        if(that.ws.readyState != WebSocket.OPEN)
          return;
        that.ws.send("R"+columns+'x'+rows);
      },
      signal(signal){
        if(that.ws.readyState != WebSocket.OPEN)
          return;
        if(signal[0]=='S')
          that.ws.send(signal);
      }
    };
    this.addOutstream(this.outstream);
  }
  connect(addr, service){
    this.service = service || null;
    var a = document.createElement("a");
    a.href = addr || '.';
    this.addr = addr = a.href.replace(/^http/,'ws');
    if(this.ws.readyState == WebSocket.OPEN)
      this.ws.close();
    this.ws = new WebSocket(addr,service);
    this.ws.addEventListener("open", ()=>this.outstream.resize(this.columns,this.rows));
    this.ws.addEventListener("message", e=>this.onmessage(e));
  }
  onmessage(e){
    if(e.data[0] == ':'){
      this.write(e.data.substr(1));
    }
  }
}

registerElement(WSterm);
