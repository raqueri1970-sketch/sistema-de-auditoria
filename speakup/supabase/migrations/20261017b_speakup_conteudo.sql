-- Speak Up IA: conteúdo das aulas no formato do método "Ouça -> Repita -> Responda -> Converse".
-- chunks: frases para ouvir e repetir (en, pt, tip opcional)
-- dialog: perguntas do professor (q, q_pt), respostas aceitas (a) e um modelo de resposta (model, model_pt)
-- scenario: instrução de role-play para a conversa com a IA
insert into english_ai.lessons (id, module_id, title, objective, sort_order, estimated_minutes, difficulty, content, active) values
('zero_04','zero','Yes, please!','Sim, não, por favor, obrigado e desculpe.',4,8,1,'{}',true),
('zero_05','zero','I like...','Dizer do que gosta e do que não gosta.',5,10,1,'{}',true),
('survival_02','survival','Pedir ajuda','Pedir ajuda e encontrar lugares.',2,10,1,'{}',true)
on conflict (id) do nothing;

update english_ai.lessons l set content = v.c::jsonb from (values
('zero_01', $j${
 "chunks":[
  {"en":"Hello!","pt":"Olá!"},
  {"en":"Hi!","pt":"Oi!"},
  {"en":"Good morning!","pt":"Bom dia!"},
  {"en":"How are you?","pt":"Como você está?"},
  {"en":"I am fine, thank you.","pt":"Estou bem, obrigado."},
  {"en":"And you?","pt":"E você?"}],
 "dialog":[
  {"q":"Hello!","q_pt":"Olá!","a":["hello","hi","good morning"],"model":"Hello!","model_pt":"Olá!"},
  {"q":"How are you?","q_pt":"Como você está?","a":["i am fine","fine","i am good","i am ok","good","great"],"model":"I am fine, thank you. And you?","model_pt":"Estou bem, obrigado. E você?"},
  {"q":"I am great, thank you! Good morning!","q_pt":"Estou ótimo, obrigado! Bom dia!","a":["good morning","morning"],"model":"Good morning!","model_pt":"Bom dia!"}],
 "scenario":"You meet the student for the very first time on a sunny morning. Greet them, ask how they are, and practice only greetings.",
 "pt_help":true}$j$),
('zero_02', $j${
 "chunks":[
  {"en":"My name is...","pt":"Meu nome é..."},
  {"en":"What is your name?","pt":"Qual é o seu nome?"},
  {"en":"Nice to meet you.","pt":"Prazer em te conhecer."},
  {"en":"I am from Brazil.","pt":"Eu sou do Brasil."},
  {"en":"Where are you from?","pt":"De onde você é?"}],
 "dialog":[
  {"q":"Hi! My name is Alex. What is your name?","q_pt":"Oi! Meu nome é Alex. Qual é o seu nome?","a":["my name is","i am","i'm"],"model":"My name is Ricardo.","model_pt":"Meu nome é Ricardo."},
  {"q":"Nice to meet you!","q_pt":"Prazer em te conhecer!","a":["nice to meet you","you too"],"model":"Nice to meet you too!","model_pt":"Prazer em te conhecer também!"},
  {"q":"Where are you from?","q_pt":"De onde você é?","a":["i am from","from brazil","brazil"],"model":"I am from Brazil.","model_pt":"Eu sou do Brasil."}],
 "scenario":"You are Alex, a friendly person at a party. Ask the student's name and where they are from. Use only very simple sentences.",
 "pt_help":true}$j$),
('zero_03', $j${
 "chunks":[
  {"en":"I want coffee.","pt":"Eu quero café."},
  {"en":"I want water.","pt":"Eu quero água."},
  {"en":"I want to go.","pt":"Eu quero ir."},
  {"en":"I don't want this.","pt":"Eu não quero isso."},
  {"en":"What do you want?","pt":"O que você quer?"}],
 "dialog":[
  {"q":"What do you want? Coffee or water?","q_pt":"O que você quer? Café ou água?","a":["i want coffee","i want water","coffee","water"],"model":"I want coffee.","model_pt":"Eu quero café."},
  {"q":"Do you want sugar?","q_pt":"Você quer açúcar?","a":["yes","no","i want sugar","i don't want","no thank you","yes please"],"model":"No, I don't want sugar.","model_pt":"Não, eu não quero açúcar."},
  {"q":"Do you want to go to the park?","q_pt":"Você quer ir ao parque?","a":["i want to go","yes","no","i don't want to go"],"model":"Yes, I want to go.","model_pt":"Sim, eu quero ir."}],
 "scenario":"You work at a small coffee shop. Ask the student what they want and help them use 'I want...' and 'I don't want...'.",
 "pt_help":true}$j$),
('zero_04', $j${
 "chunks":[
  {"en":"Yes, please.","pt":"Sim, por favor."},
  {"en":"No, thank you.","pt":"Não, obrigado."},
  {"en":"Thank you!","pt":"Obrigado!"},
  {"en":"You're welcome.","pt":"De nada."},
  {"en":"Excuse me.","pt":"Com licença."},
  {"en":"Sorry!","pt":"Desculpe!"}],
 "dialog":[
  {"q":"Do you want some cake?","q_pt":"Você quer um pedaço de bolo?","a":["yes please","no thank you","yes","no"],"model":"Yes, please.","model_pt":"Sim, por favor."},
  {"q":"Here you are.","q_pt":"Aqui está.","a":["thank you","thanks"],"model":"Thank you!","model_pt":"Obrigado!"},
  {"q":"Thank you for your help!","q_pt":"Obrigado pela sua ajuda!","a":["you're welcome","you are welcome","no problem"],"model":"You're welcome.","model_pt":"De nada."}],
 "scenario":"You are a polite neighbor offering things (cake, coffee, help). The student practices yes, no, please, thank you and you're welcome.",
 "pt_help":true}$j$),
('zero_05', $j${
 "chunks":[
  {"en":"I like music.","pt":"Eu gosto de música."},
  {"en":"I don't like rain.","pt":"Eu não gosto de chuva."},
  {"en":"I love Brazil.","pt":"Eu amo o Brasil."},
  {"en":"Do you like pizza?","pt":"Você gosta de pizza?"},
  {"en":"What do you like?","pt":"Do que você gosta?"}],
 "dialog":[
  {"q":"Do you like pizza?","q_pt":"Você gosta de pizza?","a":["i like pizza","yes","no","i don't like","i love pizza","i do"],"model":"Yes, I like pizza.","model_pt":"Sim, eu gosto de pizza."},
  {"q":"What do you like?","q_pt":"Do que você gosta?","a":["i like","i love"],"model":"I like music and football.","model_pt":"Eu gosto de música e futebol."},
  {"q":"What don't you like?","q_pt":"Do que você não gosta?","a":["i don't like","i do not like","i hate"],"model":"I don't like rain.","model_pt":"Eu não gosto de chuva."}],
 "scenario":"Chat with the student about things they like and don't like: food, music, sports. Keep it light and fun.",
 "pt_help":true}$j$),
('survival_01', $j${
 "chunks":[
  {"en":"I don't understand.","pt":"Eu não entendo."},
  {"en":"Can you repeat, please?","pt":"Pode repetir, por favor?"},
  {"en":"Slowly, please.","pt":"Devagar, por favor."},
  {"en":"How do you say this in English?","pt":"Como se diz isso em inglês?"},
  {"en":"What does it mean?","pt":"O que significa?"}],
 "dialog":[
  {"q":"The meeting starts at nine thirty tomorrow morning in the main building.","q_pt":"(frase rápida) A reunião começa às nove e meia amanhã de manhã no prédio principal.","a":["i don't understand","repeat","slowly","can you repeat","please repeat"],"model":"Can you repeat, please? Slowly, please.","model_pt":"Pode repetir, por favor? Devagar, por favor."},
  {"q":"Do you understand now?","q_pt":"Você entende agora?","a":["yes","no","a little","i understand","i don't understand"],"model":"Yes, I understand. Thank you.","model_pt":"Sim, eu entendo. Obrigado."},
  {"q":"Do you know the word 'schedule'?","q_pt":"Você conhece a palavra 'schedule'?","a":["what does it mean","no","what is","i don't know"],"model":"No. What does it mean?","model_pt":"Não. O que significa?"}],
 "scenario":"Speak a bit fast on purpose so the student practices asking you to repeat, to speak slowly and what a word means. Always slow down when asked.",
 "pt_help":true}$j$),
('survival_02', $j${
 "chunks":[
  {"en":"Can you help me?","pt":"Você pode me ajudar?"},
  {"en":"I need help.","pt":"Eu preciso de ajuda."},
  {"en":"Where is the bathroom?","pt":"Onde fica o banheiro?"},
  {"en":"I am lost.","pt":"Estou perdido."},
  {"en":"Is it far?","pt":"É longe?"}],
 "dialog":[
  {"q":"Hi! Are you OK?","q_pt":"Oi! Você está bem?","a":["i need help","can you help me","i am lost","no"],"model":"I am lost. Can you help me?","model_pt":"Estou perdido. Você pode me ajudar?"},
  {"q":"Sure! Where do you want to go?","q_pt":"Claro! Aonde você quer ir?","a":["i want to go","where is","the hotel","the station"],"model":"I want to go to the hotel.","model_pt":"Eu quero ir para o hotel."},
  {"q":"It's two blocks from here.","q_pt":"Fica a duas quadras daqui.","a":["is it far","thank you","thanks"],"model":"Is it far? Thank you!","model_pt":"É longe? Obrigado!"}],
 "scenario":"The student is a lost tourist in a city. You are a kind local helping them find places (bathroom, hotel, station).",
 "pt_help":true}$j$),
('daily_01', $j${
 "chunks":[
  {"en":"I wake up at seven.","pt":"Eu acordo às sete."},
  {"en":"I eat breakfast.","pt":"Eu tomo café da manhã."},
  {"en":"I go to work.","pt":"Eu vou para o trabalho."},
  {"en":"I come back home.","pt":"Eu volto para casa."},
  {"en":"I go to bed at eleven.","pt":"Eu vou dormir às onze."}],
 "dialog":[
  {"q":"What time do you wake up?","q_pt":"Que horas você acorda?","a":["i wake up at","at","six","seven","eight"],"model":"I wake up at seven.","model_pt":"Eu acordo às sete."},
  {"q":"What do you eat for breakfast?","q_pt":"O que você come no café da manhã?","a":["i eat","bread","coffee","eggs","fruit"],"model":"I eat bread and drink coffee.","model_pt":"Eu como pão e tomo café."},
  {"q":"What time do you go to bed?","q_pt":"Que horas você vai dormir?","a":["i go to bed at","at","ten","eleven","midnight"],"model":"I go to bed at eleven.","model_pt":"Eu vou dormir às onze."}],
 "scenario":"Ask the student about their daily routine: waking up, breakfast, work, going home and bedtime.",
 "pt_help":true}$j$),
('travel_01', $j${
 "chunks":[
  {"en":"Here is my passport.","pt":"Aqui está o meu passaporte."},
  {"en":"I am here on vacation.","pt":"Estou aqui de férias."},
  {"en":"I am staying for one week.","pt":"Vou ficar por uma semana."},
  {"en":"Where is the gate?","pt":"Onde fica o portão de embarque?"},
  {"en":"Where is baggage claim?","pt":"Onde fica a esteira de bagagens?"}],
 "dialog":[
  {"q":"Good afternoon. Passport, please.","q_pt":"Boa tarde. Passaporte, por favor.","a":["here is my passport","here you are","here it is","here"],"model":"Here is my passport.","model_pt":"Aqui está o meu passaporte."},
  {"q":"What is the purpose of your visit?","q_pt":"Qual é o motivo da sua visita?","a":["vacation","tourism","business","i am here on","holiday"],"model":"I am here on vacation.","model_pt":"Estou aqui de férias."},
  {"q":"How long are you staying?","q_pt":"Quanto tempo você vai ficar?","a":["week","weeks","days","month","i am staying"],"model":"I am staying for one week.","model_pt":"Vou ficar por uma semana."}],
 "scenario":"You are an immigration officer at a US airport, polite but direct. Ask for the passport, the purpose of the visit, how long they stay and where.",
 "pt_help":true}$j$),
('travel_02', $j${
 "chunks":[
  {"en":"I have a reservation.","pt":"Eu tenho uma reserva."},
  {"en":"I would like to check in.","pt":"Eu gostaria de fazer o check-in."},
  {"en":"What time is breakfast?","pt":"Que horas é o café da manhã?"},
  {"en":"Can I have the wifi password?","pt":"Pode me passar a senha do wi-fi?"},
  {"en":"I need a towel.","pt":"Eu preciso de uma toalha."}],
 "dialog":[
  {"q":"Welcome to the hotel! How can I help you?","q_pt":"Bem-vindo ao hotel! Como posso ajudar?","a":["i have a reservation","check in","i would like"],"model":"I have a reservation. I would like to check in.","model_pt":"Eu tenho uma reserva. Gostaria de fazer o check-in."},
  {"q":"Sure. What is your name?","q_pt":"Claro. Qual é o seu nome?","a":["my name is","i am","it's"],"model":"My name is Ricardo Silva.","model_pt":"Meu nome é Ricardo Silva."},
  {"q":"Here is your key. Anything else?","q_pt":"Aqui está a sua chave. Algo mais?","a":["breakfast","wifi","password","no thank you","thank you"],"model":"What time is breakfast?","model_pt":"Que horas é o café da manhã?"}],
 "scenario":"You are a hotel receptionist. Help the student check in, then answer questions about breakfast, wifi and the room.",
 "pt_help":true}$j$),
('travel_03', $j${
 "chunks":[
  {"en":"A table for two, please.","pt":"Uma mesa para dois, por favor."},
  {"en":"Can I see the menu?","pt":"Posso ver o cardápio?"},
  {"en":"I would like a burger.","pt":"Eu gostaria de um hambúrguer."},
  {"en":"Can I have water, please?","pt":"Pode me trazer água, por favor?"},
  {"en":"The check, please.","pt":"A conta, por favor."}],
 "dialog":[
  {"q":"Hi! How many people?","q_pt":"Oi! Quantas pessoas?","a":["two","table for","one","three","just me"],"model":"A table for two, please.","model_pt":"Uma mesa para dois, por favor."},
  {"q":"What would you like to eat?","q_pt":"O que você gostaria de comer?","a":["i would like","can i have","burger","pizza","salad","chicken"],"model":"I would like a burger, please.","model_pt":"Eu gostaria de um hambúrguer, por favor."},
  {"q":"Anything to drink?","q_pt":"Algo para beber?","a":["water","coke","juice","beer","can i have","i would like"],"model":"Can I have water, please?","model_pt":"Pode me trazer água, por favor?"}],
 "scenario":"You are a friendly waiter in an American diner. Seat the student, take the food and drink order, and bring the check at the end.",
 "pt_help":true}$j$),
('shopping_01', $j${
 "chunks":[
  {"en":"How much is it?","pt":"Quanto custa?"},
  {"en":"Do you have this in medium?","pt":"Vocês têm este no tamanho M?"},
  {"en":"Can I try it on?","pt":"Posso experimentar?"},
  {"en":"I'll take it.","pt":"Vou levar."},
  {"en":"Can I pay by card?","pt":"Posso pagar com cartão?"}],
 "dialog":[
  {"q":"Hi! Can I help you?","q_pt":"Oi! Posso ajudar?","a":["i'm just looking","i want","shirt","yes","how much"],"model":"Yes, I want a shirt.","model_pt":"Sim, eu quero uma camisa."},
  {"q":"What size are you?","q_pt":"Qual é o seu tamanho?","a":["medium","small","large","m","g","p"],"model":"Medium, please.","model_pt":"Médio, por favor."},
  {"q":"This one is twenty dollars.","q_pt":"Esta custa vinte dólares.","a":["i'll take it","i will take it","ok","card","can i pay"],"model":"I'll take it. Can I pay by card?","model_pt":"Vou levar. Posso pagar com cartão?"}],
 "scenario":"You are a clothing store clerk. Help the student buy a shirt: size, color, price, trying it on and paying.",
 "pt_help":true}$j$),
('social_01', $j${
 "chunks":[
  {"en":"Where are you from?","pt":"De onde você é?"},
  {"en":"What do you do?","pt":"O que você faz? (trabalho)"},
  {"en":"I work in retail.","pt":"Eu trabalho no varejo."},
  {"en":"What do you like to do?","pt":"O que você gosta de fazer?"},
  {"en":"Tell me about yourself.","pt":"Me fale sobre você."}],
 "dialog":[
  {"q":"Hi! I'm Sam. Where are you from?","q_pt":"Oi! Eu sou o Sam. De onde você é?","a":["i am from","brazil","i'm from"],"model":"I am from Brazil. And you?","model_pt":"Eu sou do Brasil. E você?"},
  {"q":"Cool! What do you do?","q_pt":"Legal! O que você faz?","a":["i work","i am a","i'm a","i am an"],"model":"I work in retail.","model_pt":"Eu trabalho no varejo."},
  {"q":"What do you like to do on weekends?","q_pt":"O que você gosta de fazer nos fins de semana?","a":["i like","i love","i go","i watch","i play"],"model":"I like to watch movies.","model_pt":"Eu gosto de assistir filmes."}],
 "scenario":"You are Sam, a friendly American the student meets at a coffee shop. Small talk: origin, work, hobbies. Share a little about yourself too.",
 "pt_help":true}$j$),
('business_01', $j${
 "chunks":[
  {"en":"Let me introduce myself.","pt":"Deixe-me me apresentar."},
  {"en":"I work in retail.","pt":"Eu trabalho no varejo."},
  {"en":"I am responsible for audits.","pt":"Eu sou responsável pelas auditorias."},
  {"en":"Our company has sixty stores.","pt":"Nossa empresa tem sessenta lojas."},
  {"en":"It's a pleasure to meet you.","pt":"É um prazer conhecer você."}],
 "dialog":[
  {"q":"Good morning. Could you introduce yourself?","q_pt":"Bom dia. Você poderia se apresentar?","a":["my name is","let me introduce","i am","i work"],"model":"Let me introduce myself. My name is Ricardo and I work in retail.","model_pt":"Deixe-me me apresentar. Meu nome é Ricardo e trabalho no varejo."},
  {"q":"What do you do at your company?","q_pt":"O que você faz na sua empresa?","a":["i am responsible","i work","i manage","i am the"],"model":"I am responsible for audits.","model_pt":"Eu sou responsável pelas auditorias."},
  {"q":"How big is your company?","q_pt":"Qual o tamanho da sua empresa?","a":["stores","employees","we have","our company has"],"model":"Our company has sixty stores.","model_pt":"Nossa empresa tem sessenta lojas."}],
 "scenario":"You are a business partner meeting the student at a trade fair. Ask about their job, company and responsibilities in a professional but simple way.",
 "pt_help":true}$j$),
('listening_01', $j${
 "chunks":[
  {"en":"What's your name?","pt":"Qual é o seu nome?"},
  {"en":"How old are you?","pt":"Quantos anos você tem?"},
  {"en":"Where do you live?","pt":"Onde você mora?"},
  {"en":"Do you have kids?","pt":"Você tem filhos?"},
  {"en":"What time is it?","pt":"Que horas são?"}],
 "dialog":[
  {"q":"Where do you live?","q_pt":"Onde você mora?","a":["i live in","in","brazil","city"],"model":"I live in São Paulo.","model_pt":"Eu moro em São Paulo."},
  {"q":"How old are you?","q_pt":"Quantos anos você tem?","a":["i am","years old","i'm"],"model":"I am fifty years old.","model_pt":"Eu tenho cinquenta anos."},
  {"q":"Do you have kids?","q_pt":"Você tem filhos?","a":["yes","no","i have","kids","children","son","daughter"],"model":"Yes, I have two kids.","model_pt":"Sim, eu tenho dois filhos."}],
 "scenario":"Ask the student short personal questions one at a time (where they live, age, family, time). Don't translate unless they ask; help them understand by rephrasing simply.",
 "pt_help":true}$j$),
('pronunciation_01', $j${
 "chunks":[
  {"en":"Thank you.","pt":"Obrigado.","tip":"TH: ponha a ponta da língua entre os dentes e sopre."},
  {"en":"Three.","pt":"Três.","tip":"TH de novo: língua entre os dentes, não é 'tri'."},
  {"en":"Hello.","pt":"Olá.","tip":"O H em inglês tem som de R aspirado, como em 'rato'."},
  {"en":"Water.","pt":"Água.","tip":"Fale 'uó-der', com o R no final bem leve."},
  {"en":"World.","pt":"Mundo.","tip":"Junte os lábios no W e termine com um L suave."},
  {"en":"I work.","pt":"Eu trabalho.","tip":"WORK soa 'uârk', diferente de WALK 'uók'."}],
 "dialog":[
  {"q":"Say: I think so.","q_pt":"Diga: Eu acho que sim.","a":["i think so"],"model":"I think so.","model_pt":"Eu acho que sim."},
  {"q":"Say: Three thousand.","q_pt":"Diga: Três mil.","a":["three thousand"],"model":"Three thousand.","model_pt":"Três mil."},
  {"q":"Say: Have a nice weekend!","q_pt":"Diga: Tenha um bom fim de semana!","a":["have a nice weekend"],"model":"Have a nice weekend!","model_pt":"Tenha um bom fim de semana!"}],
 "scenario":"Pronunciation coach. Give the student one short word or phrase at a time to repeat, focusing on TH, H, W and final consonants. Be encouraging; clarity matters more than accent.",
 "pt_help":true}$j$),
('review_01', $j${"mode":"spaced_repetition","dynamic":true,"chunks":[],"dialog":[],"scenario":"Review: chat using the phrases the student has practiced before.","pt_help":true}$j$),
('free_01', $j${
 "mode":"free_conversation","target_minutes":5,
 "chunks":[
  {"en":"How was your day?","pt":"Como foi o seu dia?"},
  {"en":"It was good.","pt":"Foi bom."},
  {"en":"I am tired.","pt":"Estou cansado."},
  {"en":"Tell me more.","pt":"Me conte mais."}],
 "dialog":[
  {"q":"How was your day?","q_pt":"Como foi o seu dia?","a":["it was","good","great","tired","busy","ok"],"model":"It was good, but I am tired.","model_pt":"Foi bom, mas estou cansado."},
  {"q":"What did you do today?","q_pt":"O que você fez hoje?","a":["i worked","i went","i was","work"],"model":"I worked a lot today.","model_pt":"Eu trabalhei muito hoje."},
  {"q":"What are you going to do tonight?","q_pt":"O que você vai fazer hoje à noite?","a":["i am going to","i will","watch","sleep","rest"],"model":"I am going to rest.","model_pt":"Eu vou descansar."}],
 "scenario":"Free, friendly conversation about the student's day, work, family and hobbies. Goal: keep them talking for five minutes.",
 "pt_help":true}$j$)
) as v(id, c) where l.id = v.id;
