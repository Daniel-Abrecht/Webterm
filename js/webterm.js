"use strict";

function getRatio(){
  var ctx = document.createElement("canvas").getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var bsr = ctx.webkitBackingStorePixelRatio
         || ctx.mozBackingStorePixelRatio
         || ctx.msBackingStorePixelRatio
         || ctx.oBackingStorePixelRatio
         || ctx.backingStorePixelRatio || 1;
  return dpr / bsr;
}

class Webterm {
  constructor(root){
    if(!root)
      root = document.createElement("div");
    root.tty = this;
    this.outstreams = [];
    this.root = root;
    this.root.classList.add("Webterm");
    this.root.position = "relative";
    this.pv = '\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01\x01';
    this.text = {
      fg: "#FFF",
      bg: "#000",
      bold: false,
      charset: null
    };
    this.offset = 0;
    this.scrollback = 0;
    this.columns = 80;
    this.rows = 30;
    if(this.root.dataset.size == "auto")
      this.size = "auto";
    this.cur = {x:0, y:0};
    this.scur = {x:0, y:0};
    this.lines = 1000;
    this.used_lines = 0;
    this.buffer = [];
    this.canvas = document.createElement("canvas");
    this.input = document.createElement("textarea");
    this.scroller = document.createElement("div");
    this.scrollcontent = document.createElement("div");
    this.root.innerHTML = '';
    this.root.appendChild(this.input);
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.scroller);
    this.scroller.style.overflowY = "scroll";
    this.scroller.appendChild(this.scrollcontent);
    this.root.style.overflow = "hidden";
    this.input.style.width = 0;
    this.input.style.height = 0;
    this.input.style.opacity = 0;
    this.input.style.position = 'absolute';
    this.input.style.left = 0;
    this.input.style.top = 0;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = 0;
    this.canvas.style.top = 0;
    this.scroller.style.position = 'absolute';
    this.scroller.style.right = 0;
    this.scroller.style.left = 0;
    this.scroller.style.top = 0;
    this.scroller.style.bottom = 0;
    this.input.value = this.pv;
    this.input.oninput = ()=>this.read();
    this.input.onkeydown = e=>this.specialkey(e);
    this.root.onclick = ()=>this.focus();
    this.ctx = this.canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.ratio = getRatio();
    this.setFont(14,root.dataset.font||'monospace,monospace');
    this.canvas.style.backgroundColor = "#000";
    this.onframe();
    this.scroller.addEventListener("scroll",()=>this.ondivscroll());
  }
  ondivscroll(){
    var y = this.used_lines - this.scroller.scrollTop / this.char_height |0;
    this.scroll(y);
  }
  onframe(){
    this.recalc_size();
    this.redraw();
    requestAnimationFrame(()=>this.onframe());
  }
  recalc_size(){
    if(this.size != "auto")
      return;
    var columns = this.scroller.scrollWidth / this.char_width |0;
    var rows = this.root.offsetHeight / this.char_height |0;
    if( this.columns == columns && this.rows == rows )
      return;
    this.columns = columns;
    this.rows = rows;
    this.resize();
  }
  specialkey(event){
    var key = event.keyCode || event.which;
    if(event.ctrlKey){
      event.preventDefault();
      switch(key){
        case  68: this.read("\x04"); break; // D -> EOF
        case  67: this.send_signal("SIGINT"); break; // C
        case  90: this.send_signal("SIGSTOP"); break; // Z
        case 220: this.send_signal("SIGQUIT"); break; // \
      }
    }else{
      switch(key){
        case 9: { // TAB
          event.preventDefault();
          this.read('\t');
        } break;
        case 37: { // LEFT
          event.preventDefault();
          this.read('\x1B[D');
        } break;
        case 38: { // UP
          event.preventDefault();
          this.read('\x1B[A');
        } break;
        case 39: { // RIGHT
          event.preventDefault();
          this.read('\x1B[C');
        } break;
        case 40: { // DOWN
          event.preventDefault();
          this.read('\x1B[B');
        } break;
        case 36: { // HOME
          event.preventDefault();
          this.read('\x1B[H');
        } break;
        case 35: { // END
          event.preventDefault();
          this.read('\x1B[F');
        } break;
      }
    }
  }
  send_signal(signal){
    for( var outstream of this.outstreams )
      if(outstream.signal)
        outstream.signal(signal);
  }
  resetTextProperties(){
    this.text.fg = "#FFF";
    this.text.bg = "#000";
    this.text.bold = false;
  }
  setFont(size,font){
    this.font = font;
    this.char_height = size * this.ratio |0;
    this.fontInfo = this.char_height+"px "+font;
    this.ctx.font = this.fontInfo;
    var nt = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-[]{}\\/<>+\"*%&/()=?^~|@#'";
    this.char_width = 0;
    for( var t of nt ){
      var m = this.ctx.measureText(t).width|0;
      if(this.char_width < m)
        this.char_width = m;
    }
    this.update_scrollbar();
    this.recalc_size();
    this.resize();
  }
  read(input){
    if(!input){
      var pc = this.input.value.match("^\x01*")[0].length;
      var backspaces = this.pv.length - pc;
      input = "\b".repeat(backspaces) + this.input.value.substr(pc);
    }
    this.input.value = this.pv;
    for( var outstream of this.outstreams )
      if(outstream.write)
        outstream.write(input);
    this.scroll(0);
  }
  addOutstream(os){
    if( this.outstreams.indexOf(os) == -1 )
      this.outstreams.push(os);
    if(os.resize)
      os.resize(this.columns,this.rows);
  }
  focus(){
    this.input.focus();
  }
  resize(columns,rows){
    if(columns){
      this.columns = columns;
      this.rows = rows;
    }
    for( var outstream of this.outstreams )
      if(outstream.resize)
        outstream.resize(this.columns,this.rows);
    this.canvas.width = this.columns * this.char_width * this.ratio;
    this.canvas.height = this.rows * this.char_height * this.ratio;
    this.canvas.style.width = this.columns * this.char_width + 'px';
    this.canvas.style.height = this.rows * this.char_height + 'px';
    this.update_scrollbar();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.fontInfo = this.char_height+"px "+this.font;
    this.ctx.font = this.fontInfo;
    this.ctx.textBaseline = "top";
    for( var i=0; i<this.lines+this.rows; i++ ){
      if( !this.buffer[i] )
        this.buffer[i] = [];
      if( this.buffer[i].length > this.columns )
        this.buffer[i].splice(this.columns);
      if( this.buffer[i].length < this.columns )
        for( var n=this.columns, j=this.buffer[i].length; j<n; j++)
          this.buffer[i][j] = {fg: '#FFF', bg: '#000', char: '\0', props: {}};
    }
    this.need_redraw = true;
  }
  update_scrollbar(){
    this.scrollcontent.style.height = this.root.offsetHeight + this.used_lines * this.char_height + 'px';
    this.scroller.scrollTop = this.used_lines * this.char_height;
  }
  write(text){
    for(var c of text)
      this.putchar(c);
  }
  checkSequence(){
    var incomplete_match = false;
    seqloop: for( var sequence in this.constructor.sequences ){
      var args = [];
      for( var i=0, j=0; i<sequence.length && j<this.seq.length; i++, j++){
        var s = sequence[i];
        if(s == '\x01'){
          var arg = '';
          for( ; /[0-9]/.test(this.seq[j]) && j<this.seq.length; j++ )
            arg += this.seq[j];
          args.push(parseInt(arg,10));
          j--;
          continue;
        }
        if(s == '\x02'){
          var arg = '';
          for( ; /[0-9;]/.test(this.seq[j]) && j<this.seq.length; j++ ){
            if(this.seq[j] == ';'){
              args.push(parseInt(arg,10));
              arg = '';
            }else{
              arg += this.seq[j];
            }
          }
          if(!arg)
            arg = '0';
          args.push(parseInt(arg,10));
          j--;
          continue;
        }
        if(s == '\x03'){
          if(i == sequence.length-1)
            continue seqloop;
          var e = sequence[i+1];
          var arg = '';
          for( ; this.seq[j] != e && j<this.seq.length; j++ )
            arg += this.seq[j];
          args.push(arg);
          j--;
          continue;
        }
        if(s == '\x04'){
          args.push(this.seq[j]);
          continue;
        }
        if(s != this.seq[j])
          continue seqloop;
      }
      if( j == this.seq.length && i == sequence.length )
        return ()=>this.constructor.sequences[sequence].apply(this,args);
      incomplete_match = true;
    }
    return incomplete_match;
  }
  putchar(c){
    if(this.esc){
      this.seq += c;
      var res = this.checkSequence(this.seq);
      if( res === true )
        return;
      this.esc = false;
      if( res === false ){
        this.write(this.seq);
      }else{
        res();
      }
      this.seq = null;
    }else{
      switch(c){
        case '\r': this.cur.x = 0; break;
        case '\n': this.cur.x = 0; this.nextLine(); break;
        case '\b': if(this.cur.x) this.cur.x--; break;
        case '\x07': break; // bell
        case '\x1B': this.esc=true; this.seq='^'; break; // Escape sequence
        case '\t': {
          this.cur.x += 7;
          this.cur.x %= 8;
          if(this.cur.x >= this.columns){
            this.cur.x = 0;
            this.nextLine();
          }
        } break;
        default: {
          this.setchar(this.cur.x,this.cur.y,c);
          if(++this.cur.x == this.columns){
            this.cur.x = 0;
            this.nextLine();
          }
        } break;
      }
    }
  }
  scroll(n){
    if(this.scrollback == n)
      return;
    this.scrollback = n;
    this.need_redraw = true;
  }
  nextLine(){
    if(this.cur.y < this.rows-1){
      this.cur.y++;
      return;
    }
    if( ++this.offset >= this.lines + this.rows )
      this.offset = 0;
    if( this.offset > this.used_lines )
      this.used_lines = this.offset;
    if(this.scrollback && this.scrollback<this.used_lines)
      this.scrollback++;
    this.update_scrollbar();
    this.need_redraw = true;
  }
  redraw(){
    if(!this.need_redraw)
      return;
    this.need_redraw = false;
    var rh = this.lines + this.rows;
    var ry = this.offset - this.scrollback;
    if( ry < 0 )
      ry += rh;
    for( var y=0; y<this.rows; y++, ry++ ){
      if( ry >= rh )
        ry -= rh;
      for( var x=0; x<this.columns; x++ ){
        var ch = this.buffer[ry][x];
        var c = ch.char;
        var fp = '';
        if(ch.props.bold)
          fp += "bold ";
        this.ctx.font = fp + this.fontInfo;
        var cw = this.ctx.measureText(c).width;
        var off = (this.char_width*this.ratio - cw) / 2 |0;
        this.ctx.fillStyle = ch.props.bg || "#000000";
        this.ctx.fillRect(
          x * this.char_width * this.ratio,
          y * this.char_height * this.ratio,
          Math.ceil(this.char_width * this.ratio),
          Math.ceil(this.char_height * this.ratio)
        );
        if(c != '\0'){
          var i = c.charCodeAt(0);
          if(ch.props.charset && i < 256 && i >= 33 && ch.props.charset[i])
            c = ch.props.charset[i-33];
          this.ctx.fillStyle = ch.props.fg || "#FFFFFF";
          this.ctx.fillText(c,
            x * this.char_width * this.ratio + off,
            y * this.char_height * this.ratio
          );
        }
      }
    }
  }
  getchar(x,y){
    var rh = this.lines + this.rows;
    var ry = this.offset + y;
    if(ry >= rh)
      ry -= rh;
    return this.buffer[ry][x];
  }
  setchar(x,y,c,props){
    var ch = {
      props: {},
      char: c
    };
    for( var k in this.text )
      ch.props[k] = props && props[k] || this.text[k];
    var rh = this.lines + this.rows;
    var ry = this.offset + y;
    if(ry >= rh)
      ry -= rh;
    this.buffer[ry][x] = ch;
    this.need_redraw = true;
  }
  clearLine(n){
    var i = n ? 0 : this.cur.x;
    var n = n == 1 ? this.cur.x : this.columns;
    for( ; i<n; i++ )
      this.setchar(i,this.cur.y,'\0');
  }
  clearScreen(n){
    var i = n ? 0 : this.cur.y;
    var n = n == 1 ? this.cur.y : this.rows;
    for( ; i<n; i++ )
      for( var j=0; j<this.columns; j++ )
        this.setchar(j,i,'\0');
  }
  moveCursor(x,y){
    this.cur.x = x;
    this.cur.y = y;
  }
}

Webterm.sequences = {
  "^[K"(){this.clearLine(0);},
  "^[0K"(){this.clearLine(0);},
  "^[1K"(){this.clearLine(1);},
  "^[2K"(){this.clearLine(2);},

  "^[J"(){this.clearScreen(0);},
  "^[0J"(){this.clearScreen(0);},
  "^[1J"(){this.clearScreen(1);},
  "^[2J"(){this.clearScreen(2);},

  "^[H"(){this.moveCursor(0,0);},
  "^[;H"(){this.moveCursor(0,0);},
  "^[\x01;\x01H"(y,x){this.moveCursor((x||1)-1,(y||1)-1);},
  "^[f"(){this.moveCursor(0,0);},
  "^[;f"(){this.moveCursor(0,0);},
  "^[\x01;\x01f"(y,x){this.moveCursor((x||1)-1,(y||1)-1);},
  "^[\x01d"(y){this.moveCursor(this.cur.x,(y||1)-1);},

  "^[\x02m"(...args){
    args.reverse();
    if(!args.length)
      args.push(0);
    while( args.length ){
      var cmd = args.pop();
      if(cmd == 0){
        this.resetTextProperties();
      }else if(cmd == 1){
        this.text.bold = true;
      }else if(cmd >= 30 && cmd <= 37){
        this.text.fg = this.constructor.colors4b[0][cmd-30];
      }else if(cmd >= 40 && cmd <= 47){
        this.text.bg = this.constructor.colors4b[0][cmd-40];
      }else if(cmd >= 90 && cmd <= 97){
        this.text.fg = this.constructor.colors4b[1][cmd-90];
      }else if(cmd >= 100 && cmd <= 107){
        this.text.bg = this.constructor.colors4b[1][cmd-100];
      }else if(cmd == 38 || cmd == 48){
        var q = args.pop();
        switch( q ){
          case 5: {
            var arg = args.pop() & 0xFF;
            var color = this.constructor.colors256[arg];
            if(!color){
              console.log("Invalid color256 ",arg);
              break;
            }
            if(cmd == 38) this.text.fg = color;
            if(cmd == 48) this.text.bg = color;
          } break;
          case 2: {
            var color = '#'+[args.pop()&0xFF,args.pop()&0xFF,args.pop()&0xFF].map(x=>(x<0x10?'0':'')+x.toString(16)).join('');
            if(cmd == 38) this.text.fg = color;
            if(cmd == 48) this.text.bg = color;
          } break;
        }
      }else if(cmd == 39){
        this.text.fg = "#FFFFFF";
      }else if(cmd == 49){
        this.text.bg = "#000000";
      }else{
        console.log("unsupported sequence: "+this.seq);
      }
    }

  },

  "^[\x01A"(x){ x=x||1; this.cur.y = Math.max(0,this.cur.y-x); },
  "^[\x01B"(x){ x=x||1; this.cur.y = Math.min(this.rows-1,this.cur.y+x); },
  "^[\x01C"(x){ x=x||1; this.cur.x = Math.min(this.columns-1,this.cur.x+x); },
  "^[\x01D"(x){ x=x||1; this.cur.x = Math.max(0,this.cur.x-x); },
  "^[\x01G"(x){ x=x||1; this.moveCursor(0,x-1); },

  "^[?\x01h"(x){
    console.log("DEC Private Mode set",x,"not yet implemented");
  },
  "^[?\x01l"(x){
    console.log("DEC Private Mode reset",x,"not yet implemented");
  },
  "^[\x01h"(x){
    switch(x){
      case 4: this.insert_mode = true; break;
      default: console.log("Set Mode",x,"not yet implemented"); break;
    }
  },
  "^[\x01l"(x){
    switch(x){
      case 4: this.insert_mode = true; break;
      default: console.log("Reset Mode",x,"not yet implemented"); break;
    }
  },

  "^[\x01P"(n){ // Delete characters
    n = n || 1;
    var e = this.cur.x + n;
    if(e > this.columns-1)
      e = this.columns-1;
    for( var i=this.columns-1; e<=i; i-- ){
      var ch = this.getchar(i,this.cur.y);
      this.setchar(i-e+this.cur.x,this.cur.y,ch.char,ch.props);
    }
  },
  "^[\x01X"(n){
    n = n || 1;
    var e = this.cur.x + n;
    if( e > this.columns )
      e = this.columns;
    for( var x=this.cur.x; x<e; x++ )
      this.setchar(x,this.cur.y,'\0');
  },

  "^>"(){}, // TODO: Normal keypad
  "^="(){}, // TODO: Application keypad

  "^F"(){this.moveCursor(0,this.rows-1);},
  "^7"(){this.scur={x:this.cur.x,y:this.cur.y};},
  "^8"(){this.cur={x:this.cur.x,y:this.cur.y};},

  "^(\x04"(c){
    this.text.charset = this.constructor.charsets[c] || null;
  },

  "^]0;\x03\x07"(name){
    console.log("Unimplemented: Set title: "+name);
  }

}

Webterm.charsets = {
  '0': " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£· ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
};

Webterm.colors4b = [
  ["#000000", "#de382b", "#39b54a", "#ffc706", "#006fb8", "#762671", "#2cb5e9", "#cccccc"],
  ["#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00FFFF", "#FFFFFF"]
];

Webterm.colors256 = [
  "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
  "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  "#000000", "#00005f", "#000087", "#0000af", "#0000d7", "#0000ff", "#005f00", "#005f5f",
  "#005f87", "#005faf", "#005fd7", "#005fff", "#008700", "#00875f", "#008787", "#0087af",
  "#0087d7", "#0087ff", "#00af00", "#00af5f", "#00af87", "#00afaf", "#00afd7", "#00afff",
  "#00d700", "#00d75f", "#00d787", "#00d7af", "#00d7d7", "#00d7ff", "#00ff00", "#00ff5f",
  "#00ff87", "#00ffaf", "#00ffd7", "#00ffff", "#5f0000", "#5f005f", "#5f0087", "#5f00af",
  "#5f00d7", "#5f00ff", "#5f5f00", "#5f5f5f", "#5f5f87", "#5f5faf", "#5f5fd7", "#5f5fff",
  "#5f8700", "#5f875f", "#5f8787", "#5f87af", "#5f87d7", "#5f87ff", "#5faf00", "#5faf5f",
  "#5faf87", "#5fafaf", "#5fafd7", "#5fafff", "#5fd700", "#5fd75f", "#5fd787", "#5fd7af",
  "#5fd7d7", "#5fd7ff", "#5fff00", "#5fff5f", "#5fff87", "#5fffaf", "#5fffd7", "#5fffff",
  "#870000", "#87005f", "#870087", "#8700af", "#8700d7", "#8700ff", "#875f00", "#875f5f",
  "#875f87", "#875faf", "#875fd7", "#875fff", "#878700", "#87875f", "#878787", "#8787af",
  "#8787d7", "#8787ff", "#87af00", "#87af5f", "#87af87", "#87afaf", "#87afd7", "#87afff",
  "#87d700", "#87d75f", "#87d787", "#87d7af", "#87d7d7", "#87d7ff", "#87ff00", "#87ff5f",
  "#87ff87", "#87ffaf", "#87ffd7", "#87ffff", "#af0000", "#af005f", "#af0087", "#af00af",
  "#af00d7", "#af00ff", "#af5f00", "#af5f5f", "#af5f87", "#af5faf", "#af5fd7", "#af5fff",
  "#af8700", "#af875f", "#af8787", "#af87af", "#af87d7", "#af87ff", "#afaf00", "#afaf5f",
  "#afaf87", "#afafaf", "#afafd7", "#afafff", "#afd700", "#afd75f", "#afd787", "#afd7af",
  "#afd7d7", "#afd7ff", "#afff00", "#afff5f", "#afff87", "#afffaf", "#afffd7", "#afffff",
  "#d70000", "#d7005f", "#d70087", "#d700af", "#d700d7", "#d700ff", "#d75f00", "#d75f5f",
  "#d75f87", "#d75faf", "#d75fd7", "#d75fff", "#d78700", "#d7875f", "#d78787", "#d787af",
  "#d787d7", "#d787ff", "#d7af00", "#d7af5f", "#d7af87", "#d7afaf", "#d7afd7", "#d7afff",
  "#d7d700", "#d7d75f", "#d7d787", "#d7d7af", "#d7d7d7", "#d7d7ff", "#d7ff00", "#d7ff5f",
  "#d7ff87", "#d7ffaf", "#d7ffd7", "#d7ffff", "#ff0000", "#ff005f", "#ff0087", "#ff00af",
  "#ff00d7", "#ff00ff", "#ff5f00", "#ff5f5f", "#ff5f87", "#ff5faf", "#ff5fd7", "#ff5fff",
  "#ff8700", "#ff875f", "#ff8787", "#ff87af", "#ff87d7", "#ff87ff", "#ffaf00", "#ffaf5f",
  "#ffaf87", "#ffafaf", "#ffafd7", "#ffafff", "#ffd700", "#ffd75f", "#ffd787", "#ffd7af",
  "#ffd7d7", "#ffd7ff", "#ffff00", "#ffff5f", "#ffff87", "#ffffaf", "#ffffd7", "#ffffff",
  "#080808", "#121212", "#1c1c1c", "#262626", "#303030", "#3a3a3a", "#444444", "#4e4e4e",
  "#585858", "#626262", "#6c6c6c", "#767676", "#808080", "#8a8a8a", "#949494", "#9e9e9e",
  "#a8a8a8", "#b2b2b2", "#bcbcbc", "#c6c6c6", "#d0d0d0", "#dadada", "#e4e4e4", "#eeeeee"
];

registerElement(Webterm);
