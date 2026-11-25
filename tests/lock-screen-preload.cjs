const {contextBridge}=require('electron');
let listener, calls=0, succeed=false;
let state={locked:true,version:'test',accounts:[],pane:'account',update:{status:'idle'},security:{enabled:true,touchID:true,touchIDAvailable:true}};
contextBridge.exposeInMainWorld('maxwebShell',{
 get:async()=>state,onState:fn=>{listener=fn;},
 touchID:async()=>{calls++;if(!succeed)throw Error('cancelled');state={...state,locked:false};listener?.(state);},
 unlock:async code=>{if(code!=='493725')throw Error('Неверный код');state={...state,locked:false};listener?.(state);}
});
contextBridge.exposeInMainWorld('__lockTest',{
 calls:()=>calls,succeed:()=>{succeed=true;},emit:()=>listener?.(state),
 reset:available=>{state={...state,locked:true,security:{...state.security,touchIDAvailable:available}};listener?.(state);}
});
