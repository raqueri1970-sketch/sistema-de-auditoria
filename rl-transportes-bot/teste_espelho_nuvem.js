// Teste de espelho_nuvem.js (copia nuvem -> painel em reserva e alinhamento ao iniciar). Sem rede: Supabase e WhatsApp simulados.
// Uso: node teste_espelho_nuvem.js  -> sai com codigo 0 se todos os cenarios passarem.
const assert = require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const D = require('better-sqlite3'); const db = new D(':memory:');
db.exec(`CREATE TABLE depositos (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, valor REAL NOT NULL DEFAULT 0, remetente TEXT, banco TEXT, pix TEXT, descricao TEXT, arquivo TEXT, ocr_json TEXT, saldo_restante REAL DEFAULT 0, status TEXT, created_at TEXT, arquivo_hash TEXT, data_documento TEXT, hora_documento TEXT, autenticacao TEXT);
CREATE TABLE despesas (id INTEGER PRIMARY KEY AUTOINCREMENT, deposito_id INTEGER REFERENCES depositos(id) ON DELETE SET NULL, data TEXT NOT NULL, valor REAL, remetente TEXT, fornecedor TEXT, servico TEXT, placa TEXT, nf TEXT, cnpj TEXT, banco TEXT, pix TEXT, tipo_doc TEXT, descricao TEXT, arquivo TEXT, ocr_json TEXT, status TEXT, confianca REAL, created_at TEXT, arquivo_hash TEXT, data_documento TEXT, hora_documento TEXT, autenticacao TEXT);
CREATE TABLE fornecedores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT UNIQUE NOT NULL, aliases TEXT, servicos TEXT, total_gasto REAL, total_ocorrencias INTEGER, updated_at TEXT);
CREATE TABLE ajustes (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, valor REAL NOT NULL, descricao TEXT, created_at TEXT);
CREATE TABLE saldo_inicial (id INTEGER PRIMARY KEY CHECK (id=1), valor REAL NOT NULL, data TEXT NOT NULL, descricao TEXT, created_at TEXT);`);
db.pragma('foreign_keys = ON');
db.prepare("insert into depositos (id,data,valor) values (91,'2026-10-16 09:16:47',10000)").run();
for (let i=1;i<=10;i++) db.prepare("insert into despesas (id,data,valor,deposito_id) values (?,?,?,91)").run(i,'2026-10-16 09:00:00',1);
db.prepare("insert into saldo_inicial values (1,2417.08,'2026-07-06','x','2026-07-06 13:31:43')").run();
const remoto = {
 rl_depositos: [{id:91,data:'2026-10-16T09:16:47+00:00',valor:'10000',remetente:'Paulo',ocr_json:{a:1},saldo_restante:'6372',status:'ativo',created_at:'2026-10-16T09:16:47.123+00:00',tenant_id:'esposende'}],
 rl_despesas: Array.from({length:12},(_,i)=>({id:i+1,deposito_id:91,data:'2026-10-18T13:53:02+00:00',valor:'2.5',fornecedor:'F'+i,ocr_json:{x:i},confianca:'0.9',status:'confirmado',arquivo:i==11?'WA_1792153717000_3AA251CD9A6D_Bruna.pdf':null,created_at:'2026-10-18T13:53:02+00:00',tenant_id:'esposende'})),
 rl_ajustes: [{id:10,data:'2026-07-23T14:11:14+00:00',valor:'10000',descricao:'d',created_at:'2026-07-23T14:11:14+00:00'}],
 rl_saldo_inicial: [{id:1,valor:'2417.08',data:'2026-07-06T00:00:00+00:00',descricao:'x',created_at:'2026-07-06T13:31:43+00:00'}],
 rl_fornecedores: [{id:5,nome:'MASTER POSTO LTDA',aliases:[],servicos:['a'],total_gasto:'10',total_ocorrencias:2,updated_at:'2026-10-16T09:16:34+00:00'}],
};
let logado = true;
const sb = { auth:{ getSession: async()=>({data:{session: logado?{}:null}}) },
  from: t => { let desc = false; return { select(){return this}, order(c,o){ desc = !!(o && o.ascending === false); return this},
    range: async(a,b)=>({data:(remoto[t]||[]).slice(a,b+1),error:null}),
    limit: async n => ({ data: [...(remoto[t]||[])].sort((x,y)=> desc ? y.id-x.id : x.id-y.id).slice(0,n), error:null }) }; } };
let bloqueada = true; const lider = { rlBloqueada: ()=>bloqueada };
global.setInterval = ()=>0; const st=global.setTimeout; global.setTimeout=(f,ms)=> ms>=60000?0:st(f,ms);
const pasta = fs.mkdtempSync(path.join(os.tmpdir(),'f'));
const client = { getState: async()=>'CONNECTED', getChats: async()=>[{isGroup:true,name:'RL TRANSPORTES',fetchMessages: async()=>[{hasMedia:true,timestamp:1792153717,id:{id:'3AA251CD9A6D7777'},downloadMedia: async()=>({data:Buffer.from('PDF').toString('base64')})}]}] };
const logs=[]; const e = require(process.argv[2] || path.join(__dirname, 'espelho_nuvem.js'))({ db, sb, log:(m,n)=>logs.push(m), lider, client, grupo:'RL TRANSPORTES', pastaFotos:pasta });
(async()=>{
  let r = await e.puxar('teste'); assert(r, logs.join('\n'));
  assert.equal(db.prepare('select count(*) n from despesas').get().n, 12);
  const d = db.prepare('select * from despesas where id=12').get();
  assert.equal(d.data,'2026-10-18 13:53:02'); assert.equal(d.valor,2.5); assert.equal(d.ocr_json,'{"x":11}'); assert.equal(d.confianca,0.9);
  assert.equal(db.prepare('select created_at from depositos').get().created_at,'2026-10-16 09:16:47');
  assert.equal(db.prepare('select data from saldo_inicial').get().data,'2026-07-06');
  assert.equal(db.prepare('select total_gasto from fornecedores').get().total_gasto,10);
  assert.equal(db.prepare('select data from ajustes').get().data,'2026-07-23 14:11:14');
  await new Promise(r=>st(r,50));
  assert(fs.existsSync(path.join(pasta,'WA_1792153717000_3AA251CD9A6D_Bruna.pdf')), 'pdf baixado');
  // trava: supabase vazio (sem RLS) nao apaga
  const salvo = remoto.rl_despesas; remoto.rl_despesas = [];
  r = await e.puxar('teste'); assert.equal(r,null); assert.equal(db.prepare('select count(*) n from despesas').get().n, 12);
  remoto.rl_despesas = salvo;
  // principal: nao faz nada
  bloqueada = false; r = await e.puxar('teste'); assert.equal(r,null);
  bloqueada = true; logado = false; r = await e.puxar('teste'); assert.equal(r,null);
  // ALINHAR AO INICIAR (principal): Supabase na frente -> puxa; igual -> nao mexe
  bloqueada = false; logado = true;
  db.prepare('delete from despesas where id > 5').run();
  let liberou = 0;
  await e.alinharAoIniciar(() => liberou++, { esperaMs: 1, intervaloMs: 1 });
  assert.equal(liberou, 1); assert.equal(db.prepare('select max(id) m from despesas').get().m, 12, 'puxou o que a outra lancou');
  db.prepare("insert into despesas (id,data,valor) values (13,'2026-10-19 10:00:00',7)").run();   // local na frente (ainda nao espelhado)
  await e.alinharAoIniciar(() => liberou++, { esperaMs: 1, intervaloMs: 1 });
  assert.equal(liberou, 2); assert.equal(db.prepare('select max(id) m from despesas').get().m, 13, 'local na frente: nao apaga');
  logado = false;
  await e.alinharAoIniciar(() => liberou++, { esperaMs: 1, intervaloMs: 1, tentativas: 2 });
  assert.equal(liberou, 3, 'sem Supabase libera assim mesmo');
  console.log('TODOS OK\n'+logs.join('\n'));
})().catch(x=>{console.error('FALHOU',x);process.exit(1)});
