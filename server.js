const express=require("express");
const session=require("express-session");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const multer=require("multer");
const XLSX=require("xlsx");
const path=require("path");
const fs=require("fs");

const app=express();
const PORT=process.env.PORT||3000;
const DB_FILE=process.env.DB_FILE||path.join(__dirname,"miranda.db");
const UPLOAD_DIR=path.join(__dirname,"uploads");
fs.mkdirSync(UPLOAD_DIR,{recursive:true});

const db=new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'Usuario',
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 approved_at TEXT,
 approved_by INTEGER
);
CREATE TABLE IF NOT EXISTS uploads(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 filename TEXT NOT NULL,
 type TEXT NOT NULL,
 records INTEGER NOT NULL DEFAULT 0,
 uploaded_by INTEGER NOT NULL,
 uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 dni TEXT NOT NULL,
 name TEXT,
 crop TEXT,
 position TEXT,
 entry_time TEXT,
 source_upload INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tareo(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 dni TEXT,
 name TEXT,
 crop TEXT,
 labor TEXT,
 lot TEXT,
 source_upload INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 action TEXT NOT NULL,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const admin=db.prepare("SELECT id FROM users WHERE username='admin'").get();
if(!admin){
  db.prepare("INSERT INTO users(name,username,password_hash,role,status) VALUES(?,?,?,?,?)")
    .run("Administrador","admin",bcrypt.hashSync(process.env.ADMIN_PASSWORD||"admin123",10),"Administrador","approved");
}

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
 secret:process.env.SESSION_SECRET||"cambia-esta-clave-en-produccion",
 resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000}
}));
app.use(express.static(__dirname));

const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:25*1024*1024}});

function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:"No autorizado"});next()}
function adminOnly(req,res,next){if(!req.session.user||req.session.user.role!=="Administrador")return res.status(403).json({error:"Solo administrador"});next()}
function audit(userId,action,details=""){db.prepare("INSERT INTO audit(user_id,action,details) VALUES(?,?,?)").run(userId,action,details)}

function clean(v){return String(v??"").trim()}
function findCol(headers,terms){
  const hs=headers.map(h=>clean(h).toUpperCase());
  for(const term of terms){let i=hs.findIndex(h=>h===term||h.includes(term));if(i>=0)return i}
  return -1;
}
function detect(headers){
  const h=headers.map(x=>clean(x).toUpperCase());
  if(h.includes("DNI") && h.some(x=>x.includes("H. INGRESO"))) return "ASISTENCIA";
  if(h.some(x=>x.includes("LABOR")) && h.some(x=>x.includes("LOTE"))) return "TAREO";
  return "OTRO";
}
function cropFrom(s){
  s=clean(s).toUpperCase();
  if(s.includes("CEB"))return "Cebolla";
  if(s.includes("VID")||s.includes("UVA"))return "Vid";
  if(s.includes("RIEGO"))return "Riego";
  if(s.includes("PACK"))return "Packing";
  return "Otros";
}

app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.post("/api/register",(req,res)=>{
  const {name,username,password,role}=req.body;
  if(!name||!username||!password)return res.status(400).json({error:"Completa los campos obligatorios"});
  try{
    const hash=bcrypt.hashSync(password,10);
    const info=db.prepare("INSERT INTO users(name,username,password_hash,role,status) VALUES(?,?,?,?,?)")
      .run(clean(name),clean(username).toLowerCase(),hash,clean(role)||"Usuario","pending");
    res.json({ok:true,id:info.lastInsertRowid,message:"Solicitud enviada"});
  }catch(e){res.status(400).json({error:"El usuario ya existe o los datos no son válidos"})}
});
app.post("/api/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(clean(req.body.username).toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password||"",u.password_hash))return res.status(401).json({error:"Usuario o contraseña incorrectos"});
  if(u.status!=="approved")return res.status(403).json({error:"Tu cuenta está pendiente de aprobación"});
  req.session.user={id:u.id,name:u.name,username:u.username,role:u.role};
  audit(u.id,"LOGIN");
  res.json({ok:true,user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/dashboard",auth,(req,res)=>{
  const ingresos=db.prepare("SELECT COUNT(*) c FROM attendance").get().c;
  const workers=db.prepare("SELECT COUNT(DISTINCT dni) c FROM attendance").get().c;
  const files=db.prepare("SELECT COUNT(*) c FROM uploads").get().c;
  const crops=db.prepare("SELECT crop,COUNT(*) count FROM attendance GROUP BY crop ORDER BY count DESC").all();
  const recent=db.prepare(`SELECT a.dni,a.name,a.crop,a.position,a.entry_time FROM attendance a ORDER BY a.id DESC LIMIT 15`).all();
  const pending=req.session.user.role==="Administrador"?db.prepare("SELECT COUNT(*) c FROM users WHERE status='pending'").get().c:0;
  res.json({ingresos,workers,files,pending,crops,recent});
});

app.get("/api/attendance",auth,(req,res)=>{
  const q="%"+clean(req.query.q||"")+"%";
  const crop=clean(req.query.crop||"");
  let sql="SELECT dni,name,crop,position,entry_time FROM attendance WHERE (dni LIKE ? OR name LIKE ? OR position LIKE ?)";
  const args=[q,q,q];
  if(crop){sql+=" AND crop=?";args.push(crop)}
  sql+=" ORDER BY id DESC LIMIT 1000";
  res.json(db.prepare(sql).all(...args));
});

app.get("/api/tareo",auth,(req,res)=>res.json(db.prepare("SELECT dni,name,crop,labor,lot FROM tareo ORDER BY id DESC LIMIT 1000").all()));

app.get("/api/uploads",auth,(req,res)=>{
  res.json(db.prepare(`SELECT u.filename,u.type,u.records,u.uploaded_at,usr.name uploaded_by
                       FROM uploads u JOIN users usr ON usr.id=u.uploaded_by ORDER BY u.id DESC LIMIT 100`).all());
});

app.get("/api/users",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT id,name,username,role,status,created_at,approved_at FROM users ORDER BY id DESC").all());
});
app.post("/api/users/:id/approve",adminOnly,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!u)return res.status(404).json({error:"Usuario no encontrado"});
  db.prepare("UPDATE users SET status='approved',approved_at=CURRENT_TIMESTAMP,approved_by=? WHERE id=?").run(req.session.user.id,u.id);
  audit(req.session.user.id,"APPROVE_USER",u.username);
  res.json({ok:true});
});
app.post("/api/users/:id/reject",adminOnly,(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!u)return res.status(404).json({error:"Usuario no encontrado"});
  db.prepare("UPDATE users SET status='rejected' WHERE id=?").run(u.id);
  audit(req.session.user.id,"REJECT_USER",u.username);
  res.json({ok:true});
});
app.post("/api/users/:id/block",adminOnly,(req,res)=>{
  db.prepare("UPDATE users SET status='blocked' WHERE id=?").run(req.params.id);
  audit(req.session.user.id,"BLOCK_USER",String(req.params.id));
  res.json({ok:true});
});

app.post("/api/upload",auth,upload.single("file"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"No se recibió archivo"});
  try{
    const wb=XLSX.read(fs.readFileSync(req.file.path),{type:"buffer",cellDates:true});
    let type="OTRO",records=0;
    const uploadInfo=db.prepare("INSERT INTO uploads(filename,type,records,uploaded_by) VALUES(?,?,?,?)");
    let uploadId;
    for(const sn of wb.SheetNames){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:""});
      if(!rows.length)continue;
      const headers=rows[0].map(clean), detected=detect(headers);
      if(detected==="ASISTENCIA"||detected==="TAREO"){type=detected}
      if(detected==="ASISTENCIA"){
        const iDni=findCol(headers,["DNI"]), iName=findCol(headers,["APELLIDOS Y NOMBRES","NOMBRES"]),
              iPos=findCol(headers,["PUESTO","LABOR"]), iTime=findCol(headers,["H. INGRESO","INGRESO"]);
        const ins=db.prepare("INSERT INTO attendance(dni,name,crop,position,entry_time,source_upload) VALUES(?,?,?,?,?,?)");
        const tx=db.transaction(()=>{
          for(let r=1;r<rows.length;r++){
            const row=rows[r],dni=clean(row[iDni]); if(!dni)continue;
            const name=clean(row[iName]),pos=clean(row[iPos]); let t=row[iTime];
            if(t instanceof Date)t=t.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
            ins.run(dni,name,cropFrom(pos),pos,clean(t),null);records++;
          }
        }); tx();
      } else if(detected==="TAREO"){
        const iDni=findCol(headers,["DNI"]),iName=findCol(headers,["APELLIDOS Y NOMBRES","NOMBRES"]),
              iLab=findCol(headers,["LABOR","DESCRIPCION1"]),iLot=findCol(headers,["LOTE","CUARTEL"]);
        const ins=db.prepare("INSERT INTO tareo(dni,name,crop,labor,lot,source_upload) VALUES(?,?,?,?,?,?)");
        const tx=db.transaction(()=>{
          for(let r=1;r<rows.length;r++){
            const row=rows[r],dni=clean(row[iDni]),name=clean(row[iName]),lab=clean(row[iLab]),lot=clean(row[iLot]);
            if(!(dni||name||lab))continue; ins.run(dni,name,cropFrom(lab),lab,lot,null);records++;
          }
        });tx();
      }
    }
    const info=uploadInfo.run(req.file.originalname,type,records,req.session.user.id);uploadId=info.lastInsertRowid;
    // Attach upload id to rows from this request
    if(type==="ASISTENCIA")db.prepare("UPDATE attendance SET source_upload=? WHERE source_upload IS NULL").run(uploadId);
    if(type==="TAREO")db.prepare("UPDATE tareo SET source_upload=? WHERE source_upload IS NULL").run(uploadId);
    audit(req.session.user.id,"UPLOAD",req.file.originalname+" / "+type+" / "+records);
    fs.unlinkSync(req.file.path);
    res.json({ok:true,type,records});
  }catch(e){
    try{fs.unlinkSync(req.file.path)}catch{}
    res.status(400).json({error:"No se pudo procesar el Excel: "+e.message});
  }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`Miranda Digital en http://localhost:${PORT}`));
