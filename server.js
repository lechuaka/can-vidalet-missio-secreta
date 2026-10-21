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
const safe = p => ({ id:p.id, name:p.name, color:p.color, room:p.room, connected:p.connected, done:p.done.length, tasksTotal:6, isTeacher:p.isTeacher, isOut:p.isOut });
const publicState = room => ({
  code:room.code, status:room.status, players:[...room.players.values()].map(safe),
  taskDone:room.taskDone, taskTotal:room.taskTotal, meetingEndsAt:room.meetingEndsAt,
  message:room.message, map:room.map, votes:room.votes.size, voteCount:room.votes.size
});
function broadcast(room) {
  io.to(room.code).emit("state", publicState(room));
  for (const p of room.players.values()) {
    if (p.isTeacher) p.socket.emit("teacherPrivate", {
      players:[...room.players.values()].map(x=>({...safe(x), role:x.role, doneTasks:x.done})),
      status:room.status, votes:[...room.votes.entries()], infiltrators:[...room.players.values()].filter(x=>x.role==="infiltrat").map(x=>x.name)
    });
    else p.socket.emit("myRole", {role:p.role, tasks:p.tasks, isOut:p.isOut});
  }
}
function tell(room, msg) { room.message=msg; io.to(room.code).emit("notice", msg); }
function createRoom(socket, name, teacherPin) {
  let code; do { code=roomCode(); } while(rooms.has(code));
  const room={code,players:new Map(),status:"lobby",taskDone:0,taskTotal:6,meetingEndsAt:0,votes:new Map(),message:"Sala creada. Esperem que s'hi uneixin els jugadors.",map:"school",teacherPin:teacherPin||crypto.randomBytes(3).toString("hex")};
  rooms.set(code,room);
  addPlayer(room,socket,name,true);
  socket.emit("created",{code,teacherPin:room.teacherPin});
  broadcast(room);
}
function addPlayer(room,socket,name,isTeacher=false) {
  const colors=["#ef5350","#42a5f5","#66bb6a","#ab47bc","#ffa726","#26a69a","#ec407a","#8d6e63","#5c6bc0","#d4a72c","#78909c","#ff7043"];
  const p={id:socket.id,socket,name:(name|| (isTeacher?"Mestre":"Tripulant")).slice(0,18),color:colors[room.players.size%colors.length],
    room:"pati",connected:true,isTeacher,role:isTeacher?"mestre":"tripulant",isOut:false,done:[],tasks:[],lastMove:0};
  room.players.set(socket.id,p); socket.join(room.code); socket.data.room=room.code;
  return p;
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
  room.status="playing";room.votes.clear();room.taskDone=0;room.meetingEndsAt=0;
  for(const p of players){p.role="tripulant";p.isOut=false;p.done=[];p.room="pati";}
  const count=Math.min(Number(room.infiltrators||3),Math.max(1,players.length-2));
  for(const p of players.sort(()=>Math.random()-.5).slice(0,count))p.role="infiltrat";
  const taskRooms=["aula5","biblioteca","informatica","laboratori","musica","menjador"];
  for(const p of players){p.tasks=taskRooms.slice().sort(()=>Math.random()-.5).slice(0,3);}
  room.message="La missió ha començat! Completeu les tasques i detecteu els infiltrats.";
  return true;
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
    const room=getRoom(socket); if(!room||!teacherOnly(socket,room)||pin!==room.teacherPin){socket.emit("notice","PIN de mestre incorrecte.");return;}
    if(action==="start"){if(startGame(room))tell(room,"🚀 La missió ha començat!");}
    if(action==="pause"&&room.status==="playing"){room.status="paused";tell(room,"La partida està pausada.");}
    if(action==="resume"&&room.status==="paused"){room.status="playing";tell(room,"La partida continua.");}
    if(action==="reset"){room.status="lobby";room.taskDone=0;room.votes.clear();room.meetingEndsAt=0;for(const p of room.players.values()){p.done=[];p.tasks=[];p.isOut=false;p.role=p.isTeacher?"mestre":"tripulant";p.room="pati";}tell(room,"Partida reiniciada. Ja podeu tornar a començar.");}
    if(action==="infiltrators")room.infiltrators=Math.max(1,Math.min(8,Number(value)||3));
    if(action==="remove"){const target=room.players.get(value);if(target&&!target.isTeacher){target.isOut=true;target.role="observador";tell(room,`${target.name} passa a ser observador.`);}}
    if(action==="resolve"){room.sabotage=null;tell(room,"El mestre ha resolt el problema del sistema.");}
    broadcast(room);
  });
  socket.on("move", ({room:next})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.isTeacher||p.isOut||r.status!=="playing")return;
    const allowed=["aula5","biblioteca","informatica","laboratori","musica","pati","menjador","gimnas","secreta","mestres"];
    if(!allowed.includes(next))return;
    if(Date.now()-p.lastMove<120)return;p.lastMove=Date.now();p.room=next;broadcast(r);
  });
  socket.on("completeTask", ({task,answer})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.role!=="tripulant"||p.isOut||r.status!=="playing")return;
    const answers={aula5:"56",biblioteca:"8",informatica:"g",laboratori:"dofí",musica:"1",menjador:"12"};
    if(!p.tasks.includes(task)||p.room!==task||p.done.includes(task))return;
    if(String(answer).trim().toLocaleLowerCase("ca")!==answers[task]){socket.emit("taskResult",{ok:false,message:"Encara no és correcte. Torna-ho a provar!"});return;}
    p.done.push(task);r.taskDone++;
    socket.emit("taskResult",{ok:true,message:"Molt bé! Tasca completada."});
    const crew=[...r.players.values()].filter(x=>x.role==="tripulant"&&!x.isTeacher);
    if(crew.length&&crew.every(x=>x.tasks.every(t=>x.done.includes(t)))){r.status="ended";tell(r,"🏆 Els tripulants han completat totes les tasques i han guanyat!");}
    broadcast(r);
  });
  socket.on("callMeeting",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||r.status!=="playing"||p.isOut)return;
    r.status="meeting";r.votes.clear();r.meetingEndsAt=Date.now()+60000;tell(r,`📣 ${p.name} ha convocat una reunió. Parleu i voteu!`);broadcast(r);
  });
  socket.on("vote",({target})=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||r.status!=="meeting"||!p||p.isTeacher||p.isOut||r.votes.has(p.id))return;
    if(target!=="skip"&&!r.players.has(target))return;
    r.votes.set(p.id,target);tell(r,`${p.name} ha votat. (${r.votes.size} vots registrats)`);broadcast(r);
    const voters=[...r.players.values()].filter(x=>!x.isTeacher&&!x.isOut);
    if(r.votes.size>=voters.length)finishVote(r);
  });
  socket.on("endMeeting",()=>{
    const r=getRoom(socket);if(!r||r.status!=="meeting")return;
    const p=r.players.get(socket.id);if(!p||!p.isTeacher)return;finishVote(r);
  });
  socket.on("sabotage",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.role!=="infiltrat"||p.isOut||r.status!=="playing"||r.sabotage)return;
    r.sabotage="system";tell(r,"⚠️ Incidència al sistema! Cal resoldre el repte de reparació.");broadcast(r);
  });
  socket.on("resolveSabotage",()=>{
    const r=getRoom(socket),p=r&&r.players.get(socket.id);if(!r||!p||p.role!=="tripulant"||r.status!=="playing"||!r.sabotage)return;
    r.sabotage=null;tell(r,`${p.name} ha resolt la incidència!`);broadcast(r);
  });
  socket.on("disconnect",()=>{
    const r=getRoom(socket);if(!r)return;r.players.delete(socket.id);
    if(!r.players.size)rooms.delete(r.code);else broadcast(r);
  });
});
function finishVote(room){
  const counts=new Map();for(const target of room.votes.values())if(target!=="skip")counts.set(target,(counts.get(target)||0)+1);
  const max=Math.max(0,...counts.values());const winners=[...counts.entries()].filter(x=>x[1]===max);
  if(winners.length===1&&max>0){const p=room.players.get(winners[0][0]);if(p&&!p.isTeacher){p.isOut=true;p.role="observador";tell(room,`La votació ha acabat: ${p.name} passa a ser observador.`);if(p.role==="infiltrat"){} }}
  else tell(room,"La votació ha acabat sense una decisió clara.");
  const infiltrats=[...room.players.values()].filter(p=>!p.isTeacher&&!p.isOut&&p.role==="infiltrat").length;
  const tripulants=[...room.players.values()].filter(p=>!p.isTeacher&&!p.isOut&&p.role==="tripulant").length;
  if(infiltrats===0){room.status="ended";tell(room,"🏆 Els tripulants han identificat tots els infiltrats!");}
  else if(infiltrats>=tripulants){room.status="ended";tell(room,"🕵️ Els infiltrats han aconseguit el seu objectiu!");}
  else room.status="playing";
  room.votes.clear();room.meetingEndsAt=0;broadcast(room);
}
setInterval(()=>{for(const r of rooms.values())if(r.status==="meeting"&&r.meetingEndsAt<Date.now())finishVote(r)},1000);
server.listen(PORT,()=>console.log(`Can Vidalet: Missió secreta running on ${PORT}`));
