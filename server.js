const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const safe = p => ({ id:p.id, name:p.name, color:p.color, room:p.room, connected:p.connected, done:p.done.length, tasksTotal:6, isTeacher:p.isTeacher, isOut:p.isOut, x:p.x, y:p.y, roleRevealed:p.isOut ? (p.eliminatedRole || p.role) : undefined });
const publicState = room => ({
  code:room.code, status:room.status, players:[...room.players.values()].map(safe),
  taskDone:room.taskDone, taskTotal:room.taskTotal, meetingEndsAt:room.meetingEndsAt, discussionEndsAt:room.discussionEndsAt,
  message:room.message, map:room.map, votes:room.votes.size, voteCount:room.votes.size,
  bodies:room.bodies.map(b=>({id:b.id,x:b.x,y:b.y,name:b.name,reported:b.reported})),
  sabotage:room.sabotage, lastMeetingReason:room.lastMeetingReason
});
function broadcast(room) {
  io.to(room.code).emit("state", publicState(room));
  for (const p of room.players.values()) {
    if (p.isTeacher) p.socket.emit("teacherPrivate", {
      players:[...room.players.values()].map(x=>({...safe(x), role:x.role, doneTasks:x.done})),
      status:room.status, votes:[...room.votes.entries()],
      infiltrators:[...room.players.values()].filter(x=>x.role==="infiltrat"&&!x.isTeacher).map(x=>x.name)
    });
    else p.socket.emit("myRole", {role:p.role, tasks:p.tasks, isOut:p.isOut, canEliminate:p.role==="infiltrat"&&!p.isOut});
  }
}
function tell(room, msg) { room.message=msg; io.to(room.code).emit("notice", msg); }
function createRoom(socket, name, teacherPin) {
  let code; do { code=roomCode(); } while(rooms.has(code));
  const room={code,players:new Map(),status:"lobby",taskDone:0,taskTotal:6,meetingEndsAt:0,discussionEndsAt:0,votes:new Map(),message:"Sala creada. Esperem que s'hi uneixin els jugadors.",map:"school",teacherPin:teacherPin||crypto.randomBytes(3).toString("hex"),infiltrators:3,bodies:[],sabotage:null,lastMeetingReason:""};
  rooms.set(code,room); addPlayer(room,socket,name,true);
  socket.emit("created",{code,teacherPin:room.teacherPin}); broadcast(room);
}
function addPlayer(room,socket,name,isTeacher=false) {
  const colors=["#ef5350","#42a5f5","#66bb6a","#ab47bc","#ffa726","#26a69a","#ec407a","#8d6e63","#5c6bc0","#d4a72c","#78909c","#ff7043"];
  const p={id:socket.id,socket,name:(name||(isTeacher?"Mestre":"Tripulant")).slice(0,18),color:colors[room.players.size%colors.length],room:"pati",connected:true,isTeacher,role:isTeacher?"mestre":"tripulant",isOut:false,done:[],tasks:[],lastMove:0,lastElimination:0,x:500,y:565};
  room.players.set(socket.id,p); socket.join(room.code); socket.data.room=room.code; return p;
}
function getRoom(socket) { return rooms.get(socket.data.room); }
function teacherOnly(socket, room) {
  const p=room && room.players.get(socket.id);
  if(!p || !p.isTeacher) { socket.emit("notice","Aquesta acció només la pot fer el mestre."); return false; }
  return true;
}
function startGame(room) {
  const players=[...room.players.values()].filter(p=>!p.isTeacher);
  if(players.length<4){room.message="Calen almenys 4 alumnes per començar.";return false;}
  room.status="playing";room.votes.clear();room.taskDone=0;room.meetingEndsAt=0;room.discussionEndsAt=0;room.bodies=[];room.sabotage=null;
  for(const p of players){p.role="tripulant";p.isOut=false;p.eliminatedRole=null;p.done=[];p.room="pati";p.x=500;p.y=565;p.lastElimination=0;}
  const count=Math.min(Number(room.infiltrators||3),Math.max(1,players.length-2));
  for(const p of players.slice().sort(()=>Math.random()-.5).slice(0,count))p.role="infiltrat";
  const taskRooms=["aula5","biblioteca","informatica","laboratori","musica","menjador"];
  for(const p of players)p.tasks=taskRooms.slice().sort(()=>Math.random()-.5).slice(0,3);
  room.taskTotal=players.reduce((n,p)=>n+p.tasks.length,0);
  room.message="La missió ha començat! Completeu les tasques i detecteu els infiltrats.";return true;
}
const roomRects=[
  {id:"aula5",x:45,y:45,w:250,h:150},{id:"biblioteca",x:355,y:45,w:250,h:150},{id:"informatica",x:665,y:45,w:290,h:150},
  {id:"laboratori",x:45,y:260,w:250,h:150},{id:"musica",x:355,y:260,w:250,h:150},{id:"menjador",x:665,y:260,w:290,h:150},
  {id:"pati",x:365,y:475,w:270,h:190},{id:"gimnas",x:705,y:475,w:250,h:190},{id:"secreta",x:45,y:475,w:250,h:190}
];
function inRect(x,y,r,pad=0){return x>=r.x-pad&&x<=r.x+r.w+pad&&y>=r.y-pad&&y<=r.y+r.h+pad;}
function walkable(x,y){
  if(roomRects.some(r=>inRect(x,y,r))) return true;
  // Passadissos principals i connexions estretes a les portes.
  const halls=(x>=295&&x<=355&&y>=100&&y<=555) ||
    (x>=295&&x<=965&&y>=205&&y<=260) ||
    (x>=295&&x<=965&&y>=410&&y<=465) ||
    (x>=295&&x<=705&&y>=555&&y<=605) ||
    (x>=470&&x<=530&&y>=410&&y<=485);
  if(halls)return true;
  // Les portes superiors connecten les aules de dalt amb el passadís.
  const topRooms=roomRects.filter(r=>r.y===45);
  if(topRooms.some(r=>x>=r.x+r.w/2-23&&x<=r.x+r.w/2+23&&y>=190&&y<=210))return true;
  // Portes d'accés a pati, gimnàs i aula secreta.
  const lowerRooms=roomRects.filter(r=>r.y>=450);
  if(lowerRooms.some(r=>x>=r.x+r.w/2-23&&x<=r.x+r.w/2+23&&y>=455&&y<=485))return true;
  return false;
}
function updateRoom(p){
  const r=roomRects.find(r=>inRect(p.x,p.y,r));
  if(r)p.room=r.id;
  else p.room="passadis";
}
function checkWin(room){
  const live=[...room.players.values()].filter(p=>!p.isTeacher&&!p.isOut);
  const infiltrats=live.filter(p=>p.role==="infiltrat").length;
  const tripulants=live.filter(p=>p.role==="tripulant").length;
  if(infiltrats===0){room.status="ended";tell(room,"🏆 Els tripulants han identificat tots els infiltrats!");return true;}
  if(infiltrats>=tripulants){room.status="ended";tell(room,"🕵️ Els infiltrats han aconseguit el seu objectiu!");return true;}
  return false;
}
function startDiscussion(room,message){
  room.status="discussion";room.votes.clear();room.discussionEndsAt=Date.now()+30000;room.meetingEndsAt=0;
  tell(room,`${message} Debat obert durant 30 segons; després començarà la votació.`);broadcast(room);
}
function startVoting(room){
  if(room.status!=="discussion")return;
  room.status="meeting";room.votes.clear();room.discussionEndsAt=0;room.meetingEndsAt=Date.now()+45000;
  tell(room,"🗳️ Comença la votació! Trieu un jugador o absteniu-vos.");broadcast(room);
}
io.on("connection", socket => {
  socket.on("createRoom", ({name})=>createRoom(socket,name));
  socket.on("joinRoom", ({code,name})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room){socket.emit("joinError","No trobo aquesta sala. Comprova el codi.");return;}
    if(room.status!=="lobby"){socket.emit("joinError","La partida ja ha començat.");return;}
    if([...room.players.values()].filter(p=>!p.isTeacher).length>=40){socket.emit("joinError","La sala és plena (màxim 40 alumnes).");return;}
    addPlayer(room,socket,name,false);tell(room,`${name||"Un jugador"} s'ha unit a la sala.`);broadcast(room);
  });
  socket.on("teacherAction", ({pin,action,value})=>{
    const room=getRoom(socket); if(!room||!teacherOnly(socket,room))return;
    if(pin!==room.teacherPin){socket.emit("notice","PIN de mestre incorrecte.");return;}
    if(action==="start"){if(startGame(room))tell(room,"🚀 La missió ha començat!");}
    if(action==="pause"&&room.status==="playing"){room.status="paused";tell(room,"La partida està pausada.");}
    if(action==="resume"&&room.status==="paused"){room.status="playing";tell(room,"La partida continua.");}
    if(action==="reset"){room.status="lobby";room.taskDone=0;room.votes.clear();room.meetingEndsAt=0;room.discussionEndsAt=0;room.taskTotal=6;room.bodies=[];room.sabotage=null;for(const p of room.players.values()){p.done=[];p.tasks=[];p.isOut=false;p.eliminatedRole=null;p.role=p.isTeacher?"mestre":"tripulant";p.room="pati";p.x=500;p.y=565;}tell(room,"Partida reiniciada. Ja podeu tornar a començar.");}
    if(action==="infiltrators")room.infiltrators=Math.max(1,Math.min(8,Number(value)||3));
    if(action==="remove"){const target=room.players.get(value);if(target&&!target.isTeacher&&!target.isOut){target.isOut=true;target.role="observador";tell(room,`${target.name} passa a ser observador.`);}}
    if(action==="resolve"){room.sabotage=null;tell(room,"El mestre ha resolt el problema del sistema.");}
    broadcast(room);
  });
  socket.on("move", ({room:next,x,y})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.isTeacher||p.isOut||r.status!=="playing")return;
    if(Date.now()-p.lastMove<60)return;p.lastMove=Date.now();
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    x=Math.max(24,Math.min(976,x));y=Math.max(24,Math.min(696,y));
    if(p.role!=="infiltrat"){
      const distance=Math.hypot(x-p.x,y-p.y),steps=Math.max(1,Math.ceil(distance/8));
      let valid=true;
      for(let i=1;i<=steps;i++){const sx=p.x+(x-p.x)*i/steps,sy=p.y+(y-p.y)*i/steps;if(!walkable(sx,sy)){valid=false;break;}}
      if(!valid){socket.emit("moveRejected",{x:p.x,y:p.y});return;}
    }
    p.x=x;p.y=y;updateRoom(p);broadcast(r);
  });
  socket.on("eliminate",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);
    if(!r||!p||p.role!=="infiltrat"||p.isOut||r.status!=="playing"||r.sabotage)return;
    const now=Date.now();if(now-p.lastElimination<25000){socket.emit("notice","Has d'esperar abans de tornar a eliminar.");return;}
    const target=[...r.players.values()].filter(q=>!q.isTeacher&&!q.isOut&&q.role==="tripulant"&&q.id!==p.id&&Math.hypot(q.x-p.x,q.y-p.y)<=42).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if(!target){socket.emit("notice","Acosta't a un tripulant per eliminar-lo.");return;}
    p.lastElimination=now;target.isOut=true;target.eliminatedRole=target.role;target.role="observador";r.bodies.push({id:crypto.randomBytes(4).toString("hex"),x:target.x,y:target.y,name:target.name,reported:false});
    tell(r,`🚨 ${target.name} ha estat eliminat. Un tripulant pot informar del cos.`);checkWin(r);broadcast(r);
  });
  socket.on("reportBody",({bodyId}={})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);
    if(!r||!p||p.isTeacher||p.role!=="tripulant"||p.isOut||r.status!=="playing")return;
    const body=r.bodies.find(b=>b.id===bodyId&&!b.reported);
    if(!body||Math.hypot(body.x-p.x,body.y-p.y)>55){socket.emit("notice","Acosta't a un cos per informar-ne.");return;}
    body.reported=true;startDiscussion(r,`📣 ${p.name} ha informat d'un cos. ${body.name} ha estat eliminat.`);r.lastMeetingReason=`Cos trobat de ${body.name}`;
  });
  socket.on("callMeeting",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);
    if(!r||!p||p.isTeacher||p.isOut||r.status!=="playing")return;
    startDiscussion(r,`📣 ${p.name} ha convocat una reunió d'emergència.`);
  });
  socket.on("vote",({target})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||r.status!=="meeting"||!p||p.isTeacher||p.isOut||p.role!=="tripulant"&&p.role!=="infiltrat"||r.votes.has(p.id))return;
    if(target!=="skip"){const chosen=r.players.get(target);if(!chosen||chosen.isTeacher||chosen.isOut)return;}
    r.votes.set(p.id,target);tell(r,`${p.name} ha votat. (${r.votes.size} vots registrats)`);broadcast(r);
    const voters=[...r.players.values()].filter(x=>!x.isTeacher&&!x.isOut);
    if(r.votes.size>=voters.length)finishVote(r);
  });
  socket.on("endMeeting",()=>{const r=getRoom(socket);if(!r||r.status!=="meeting")return;const p=r.players.get(socket.id);if(!p||!p.isTeacher)return;finishVote(r);});
  socket.on("sabotage",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.role!=="infiltrat"||p.isOut||r.status!=="playing"||r.sabotage)return;
    r.sabotage="system";tell(r,"⚠️ Incidència al sistema! Cal resoldre el repte de reparació.");broadcast(r);
  });
  socket.on("resolveSabotage",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.role!=="tripulant"||p.isOut||r.status!=="playing"||!r.sabotage)return;
    r.sabotage=null;tell(r,`${p.name} ha resolt la incidència!`);broadcast(r);
  });
  socket.on("completeTask", ({task,answer})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);
    if(!r||!p||p.role!=="tripulant"||p.isOut||r.status!=="playing")return;
    const answers={aula5:"56",biblioteca:"8",informatica:"g",laboratori:"dofi",musica:"1",menjador:"12"};
    const normalise=v=>String(v??"").trim().toLocaleLowerCase("ca").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    if(!p.tasks.includes(task)){socket.emit("taskResult",{ok:false,message:"Aquesta tasca no forma part de les teves missions assignades."});return;}
    if(p.done.includes(task)){socket.emit("taskResult",{ok:false,message:"Aquesta tasca ja està completada."});return;}
    const roomDef=roomRects.find(x=>x.id===task);
    if(!roomDef||!inRect(p.x,p.y,roomDef)){socket.emit("taskResult",{ok:false,message:"Entra a l'aula de la tasca per poder registrar-la."});return;}
    if(normalise(answer)!==answers[task]){socket.emit("taskResult",{ok:false,message:"La resposta no és correcta. Torna-ho a provar!"});return;}
    p.done.push(task);r.taskDone++;socket.emit("taskResult",{ok:true,message:"Molt bé! Tasca completada i registrada."});
    const crew=[...r.players.values()].filter(x=>!x.isTeacher&&x.role==="tripulant");
    const allTasksDone=crew.length&&crew.every(x=>x.tasks.every(t=>x.done.includes(t)));
    if(allTasksDone){r.status="ended";tell(r,"🏆 Els tripulants han completat totes les missions i han guanyat!");}
    else checkWin(r);
    broadcast(r);
  });
  socket.on("disconnect",()=>{const r=getRoom(socket);if(!r)return;r.players.delete(socket.id);if(!r.players.size)rooms.delete(r.code);else broadcast(r);});
});
function finishVote(room){
  const counts=new Map();for(const target of room.votes.values())if(target!=="skip")counts.set(target,(counts.get(target)||0)+1);
  const max=Math.max(0,...counts.values()), winners=[...counts.entries()].filter(x=>x[1]===max);
  if(winners.length===1&&max>0){const p=room.players.get(winners[0][0]);if(p&&!p.isTeacher&&!p.isOut){const wasInfiltrat=p.role==="infiltrat";p.isOut=true;p.eliminatedRole=p.role;p.role="observador";room.bodies.push({id:crypto.randomBytes(4).toString("hex"),x:p.x,y:p.y,name:p.name,reported:true});tell(room,`La votació ha acabat: ${p.name} passa a ser observador${wasInfiltrat?" i era un infiltrat":" i era un tripulant"}.`);}}
  else tell(room,"La votació ha acabat en empat o sense vots: ningú no és eliminat.");
  room.votes.clear();room.meetingEndsAt=0;room.status="playing";if(!checkWin(room))broadcast(room);
  else broadcast(room);
}
setInterval(()=>{for(const r of rooms.values()){if(r.status==="discussion"&&r.discussionEndsAt<Date.now())startVoting(r);else if(r.status==="meeting"&&r.meetingEndsAt<Date.now())finishVote(r)}},500);
server.listen(PORT,()=>console.log(`Can Vidalet: Missió secreta running on ${PORT}`));
