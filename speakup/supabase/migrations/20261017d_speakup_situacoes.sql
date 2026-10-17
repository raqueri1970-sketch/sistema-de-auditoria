-- SpeakUp IA: situações de conversa para o aluno escolher o foco (viagem, restaurante, negócios, lazer...).
alter table english_ai.profiles add column if not exists focus text[] not null default '{}';

insert into english_ai.modules (id, title, description, icon, sort_order, active) values
('food','Restaurante e comida','Pedir comida, café, pedidos especiais e a conta.','🍽️',5,true),
('leisure','Lazer e passeios','Passeios, ingressos, bar com amigos e hobbies.','🎉',7,true),
('health','Saúde e emergência','Farmácia, médico e pedir socorro.','🏥',8,true)
on conflict (id) do update set title = excluded.title, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order, active = true;

update english_ai.modules set sort_order = v.o from (values
  ('zero',1),('survival',2),('daily',3),('travel',4),('food',5),('shopping',6),('leisure',7),('health',8),
  ('social',9),('business',10),('listening',11),('pronunciation',12),('review',13),('free',14)) as v(id,o)
where modules.id = v.id;
update english_ai.modules set description = 'Aeroporto, hotel, transporte, direções e imprevistos.' where id = 'travel';

update english_ai.lessons set module_id = 'food', sort_order = 1, title = 'Pedir no restaurante' where id = 'travel_03';

insert into english_ai.lessons (id, module_id, title, objective, sort_order, estimated_minutes, difficulty, content, active) values
('travel_05','travel','Pedir direções','Perguntar o caminho e entender a resposta.',5,10,2, $j${
 "chunks":[
  {"en":"Excuse me, where is the station?","pt":"Com licença, onde fica a estação?"},
  {"en":"Is it far from here?","pt":"É longe daqui?"},
  {"en":"Go straight and turn left.","pt":"Siga reto e vire à esquerda."},
  {"en":"Can you show me on the map?","pt":"Pode me mostrar no mapa?"},
  {"en":"I'm lost.","pt":"Estou perdido."}],
 "dialog":[
  {"q":"Hi, can I help you?","q_pt":"Oi, posso ajudar?","a":["where is","i'm lost","im lost","station","excuse me"],"model":"Yes, please. Where is the station?","model_pt":"Sim, por favor. Onde fica a estação?"},
  {"q":"Go straight and turn left at the bank.","q_pt":"Siga reto e vire à esquerda no banco.","a":["is it far","far","thank you","map","thanks"],"model":"Is it far from here?","model_pt":"É longe daqui?"},
  {"q":"No, it's about five minutes on foot.","q_pt":"Não, uns cinco minutos a pé.","a":["thank you","thanks","great","perfect"],"model":"Great, thank you very much!","model_pt":"Ótimo, muito obrigado!"}],
 "scenario":"You are a friendly local on the street. The student is a tourist asking for directions. Give simple directions (straight, left, right, next to, minutes on foot).",
 "pt_help":true}$j$::jsonb, true),
('travel_06','travel','Problemas na viagem','Resolver mala perdida, voo atrasado e quarto com problema.',6,12,3, $j${
 "chunks":[
  {"en":"My bag didn't arrive.","pt":"Minha mala não chegou."},
  {"en":"My flight is delayed.","pt":"Meu voo está atrasado."},
  {"en":"The air conditioning doesn't work.","pt":"O ar-condicionado não funciona."},
  {"en":"Can you help me, please?","pt":"Pode me ajudar, por favor?"},
  {"en":"What can I do?","pt":"O que eu posso fazer?"}],
 "dialog":[
  {"q":"Good afternoon. How can I help?","q_pt":"Boa tarde. Como posso ajudar?","a":["bag","didn't arrive","didnt arrive","help me","my bag"],"model":"My bag didn't arrive. Can you help me, please?","model_pt":"Minha mala não chegou. Pode me ajudar, por favor?"},
  {"q":"I'm sorry. What's your flight number?","q_pt":"Sinto muito. Qual o número do seu voo?","a":["flight","it's","its","number","from"],"model":"It's flight 302 from São Paulo.","model_pt":"É o voo 302 de São Paulo."},
  {"q":"We will send the bag to your hotel tomorrow.","q_pt":"Vamos mandar a mala para o seu hotel amanhã.","a":["thank you","thanks","ok","what time","great"],"model":"OK, thank you. What time?","model_pt":"Ok, obrigado. Que horas?"}],
 "scenario":"You are an airline desk agent and later a hotel receptionist. The student has travel problems: lost bag, delayed flight, a broken air conditioner. Be calm and helpful.",
 "pt_help":true}$j$::jsonb, true),
('food_02','food','Café e lanchonete','Pedir café, lanche e para viagem.',2,10,1, $j${
 "chunks":[
  {"en":"Can I have a coffee, please?","pt":"Pode me ver um café, por favor?"},
  {"en":"With milk, please.","pt":"Com leite, por favor."},
  {"en":"For here or to go?","pt":"Para comer aqui ou para viagem?"},
  {"en":"To go, please.","pt":"Para viagem, por favor."},
  {"en":"A sandwich and a juice.","pt":"Um sanduíche e um suco."}],
 "dialog":[
  {"q":"Hi! What would you like?","q_pt":"Oi! O que você gostaria?","a":["coffee","can i have","i want","i'd like","id like","sandwich"],"model":"Can I have a coffee, please?","model_pt":"Pode me ver um café, por favor?"},
  {"q":"Sure. With milk?","q_pt":"Claro. Com leite?","a":["yes","no","with milk","please","black"],"model":"Yes, with milk, please.","model_pt":"Sim, com leite, por favor."},
  {"q":"For here or to go?","q_pt":"Para comer aqui ou para viagem?","a":["to go","for here","here"],"model":"To go, please.","model_pt":"Para viagem, por favor."}],
 "scenario":"You are a barista at a busy coffee shop. The student orders coffee and a snack. Ask about size, milk, and for here or to go.",
 "pt_help":true}$j$::jsonb, true),
('food_03','food','Pedidos especiais e a conta','Falar de alergia, pedir sem algo, reclamar e pagar.',3,12,2, $j${
 "chunks":[
  {"en":"I'm allergic to peanuts.","pt":"Sou alérgico a amendoim."},
  {"en":"Without onions, please.","pt":"Sem cebola, por favor."},
  {"en":"This is cold.","pt":"Isto está frio."},
  {"en":"Can we have the check, please?","pt":"Pode trazer a conta, por favor?"},
  {"en":"Can I pay by card?","pt":"Posso pagar no cartão?"}],
 "dialog":[
  {"q":"Are you ready to order?","q_pt":"Prontos para pedir?","a":["i'd like","id like","i want","please","without","allergic"],"model":"Yes. I'd like the chicken, without onions, please.","model_pt":"Sim. Quero o frango, sem cebola, por favor."},
  {"q":"How is everything?","q_pt":"Está tudo bem?","a":["good","great","delicious","cold","fine"],"model":"It's delicious, thank you!","model_pt":"Está delicioso, obrigado!"},
  {"q":"Can I get you anything else?","q_pt":"Mais alguma coisa?","a":["check","bill","no thank you","card","pay"],"model":"No, thank you. Can we have the check, please?","model_pt":"Não, obrigado. Pode trazer a conta, por favor?"}],
 "scenario":"You are a waiter at a restaurant. The student orders with special requests (allergy, without an ingredient), comments on the food and asks for the check and card payment.",
 "pt_help":true}$j$::jsonb, true),
('shopping_02','shopping','Trocar e experimentar','Experimentar, pedir outro tamanho e trocar.',2,10,2, $j${
 "chunks":[
  {"en":"Can I try this on?","pt":"Posso experimentar?"},
  {"en":"Do you have a bigger size?","pt":"Tem um tamanho maior?"},
  {"en":"It's too small.","pt":"Está pequeno demais."},
  {"en":"I'd like to return this.","pt":"Quero devolver isto."},
  {"en":"Here is the receipt.","pt":"Aqui está o recibo."}],
 "dialog":[
  {"q":"Hi! Can I help you?","q_pt":"Oi! Posso ajudar?","a":["try","try this on","can i","size"],"model":"Yes. Can I try this on?","model_pt":"Sim. Posso experimentar?"},
  {"q":"Sure, the fitting room is there. How is it?","q_pt":"Claro, o provador é ali. Como ficou?","a":["too small","too big","bigger","smaller","good","perfect"],"model":"It's too small. Do you have a bigger size?","model_pt":"Está pequeno. Tem um tamanho maior?"},
  {"q":"Here you are. Anything else?","q_pt":"Aqui está. Mais alguma coisa?","a":["no thank you","that's all","thats all","how much","thanks"],"model":"No, thank you. How much is it?","model_pt":"Não, obrigado. Quanto custa?"}],
 "scenario":"You are a clerk at a clothing store. The student tries on clothes, asks for other sizes and later wants to return an item with the receipt.",
 "pt_help":true}$j$::jsonb, true),
('leisure_01','leisure','Passeios e ingressos','Comprar ingresso, perguntar horário e preço.',1,10,1, $j${
 "chunks":[
  {"en":"Two tickets, please.","pt":"Dois ingressos, por favor."},
  {"en":"What time does it open?","pt":"Que horas abre?"},
  {"en":"Is there a discount for seniors?","pt":"Tem desconto para idosos?"},
  {"en":"Can I take pictures?","pt":"Posso tirar fotos?"},
  {"en":"Where is the entrance?","pt":"Onde fica a entrada?"}],
 "dialog":[
  {"q":"Hello! How many tickets?","q_pt":"Olá! Quantos ingressos?","a":["two","one","three","tickets","please"],"model":"Two tickets, please.","model_pt":"Dois ingressos, por favor."},
  {"q":"That's forty dollars. Anything else?","q_pt":"São quarenta dólares. Mais alguma coisa?","a":["pictures","photos","what time","close","discount"],"model":"Can I take pictures inside?","model_pt":"Posso tirar fotos lá dentro?"},
  {"q":"Yes, but no flash. Enjoy the museum!","q_pt":"Sim, mas sem flash. Aproveite o museu!","a":["thank you","thanks","great"],"model":"Thank you!","model_pt":"Obrigado!"}],
 "scenario":"You sell tickets at a museum and later at a city tour. The student asks for tickets, opening hours, prices and rules.",
 "pt_help":true}$j$::jsonb, true),
('leisure_02','leisure','Bar e amigos','Pedir bebida, puxar papo e fazer um brinde.',2,10,2, $j${
 "chunks":[
  {"en":"A beer, please.","pt":"Uma cerveja, por favor."},
  {"en":"What do you recommend?","pt":"O que você recomenda?"},
  {"en":"Cheers!","pt":"Saúde! (brinde)"},
  {"en":"Is this seat free?","pt":"Este lugar está livre?"},
  {"en":"This one is on me.","pt":"Esta é por minha conta."}],
 "dialog":[
  {"q":"Hey! What can I get you?","q_pt":"E aí! O que vai ser?","a":["beer","please","recommend","a wine","water"],"model":"A beer, please. What do you recommend?","model_pt":"Uma cerveja, por favor. O que você recomenda?"},
  {"q":"Try our local beer. It's great!","q_pt":"Prove nossa cerveja local. É ótima!","a":["ok","sure","great","i'll try","ill try","yes"],"model":"OK, I'll try it!","model_pt":"Ok, vou provar!"},
  {"q":"Here you go. Are you here on vacation?","q_pt":"Aqui está. Está aqui de férias?","a":["yes","vacation","i'm from","im from","brazil","work"],"model":"Yes, I'm on vacation. I'm from Brazil.","model_pt":"Sim, estou de férias. Sou do Brasil."}],
 "scenario":"You are a friendly bartender and later a local person at the bar. Chat casually: drinks, where the student is from, plans for the trip.",
 "pt_help":true}$j$::jsonb, true),
('leisure_03','leisure','Hobbies e fim de semana','Contar o que gosta de fazer e combinar um programa.',3,10,2, $j${
 "chunks":[
  {"en":"I like to watch football.","pt":"Gosto de assistir futebol."},
  {"en":"What do you do on the weekend?","pt":"O que você faz no fim de semana?"},
  {"en":"Do you want to go to the beach?","pt":"Quer ir à praia?"},
  {"en":"Sounds good!","pt":"Parece ótimo! / Boa!"},
  {"en":"See you on Saturday.","pt":"Te vejo no sábado."}],
 "dialog":[
  {"q":"What do you do on the weekend?","q_pt":"O que você faz no fim de semana?","a":["i like","i watch","i go","football","beach","family"],"model":"I like to watch football with my family.","model_pt":"Gosto de assistir futebol com a minha família."},
  {"q":"Nice! Do you want to go to the beach on Saturday?","q_pt":"Legal! Quer ir à praia no sábado?","a":["sounds good","yes","sure","great","ok"],"model":"Sounds good!","model_pt":"Boa!"},
  {"q":"Great. Let's meet at ten.","q_pt":"Ótimo. Vamos nos encontrar às dez.","a":["see you","ok","perfect","great"],"model":"Perfect. See you on Saturday!","model_pt":"Perfeito. Te vejo no sábado!"}],
 "scenario":"You are a new friend. Talk about hobbies, sports, music and weekend plans, then invite the student to do something together.",
 "pt_help":true}$j$::jsonb, true),
('health_01','health','Farmácia e médico','Dizer o que sente e pedir remédio.',1,10,2, $j${
 "chunks":[
  {"en":"I have a headache.","pt":"Estou com dor de cabeça."},
  {"en":"I don't feel well.","pt":"Não estou me sentindo bem."},
  {"en":"Do you have something for a cold?","pt":"Tem algo para resfriado?"},
  {"en":"How many times a day?","pt":"Quantas vezes por dia?"},
  {"en":"I need a doctor.","pt":"Preciso de um médico."}],
 "dialog":[
  {"q":"Hi! How can I help you?","q_pt":"Oi! Como posso ajudar?","a":["headache","i have","i don't feel","i dont feel","something for"],"model":"I have a headache. Do you have something for it?","model_pt":"Estou com dor de cabeça. Tem algo para isso?"},
  {"q":"Yes, take this medicine.","q_pt":"Sim, tome este remédio.","a":["how many","times","how much","a day"],"model":"How many times a day?","model_pt":"Quantas vezes por dia?"},
  {"q":"Two times a day, after meals.","q_pt":"Duas vezes por dia, depois das refeições.","a":["thank you","thanks","ok","how much"],"model":"OK, thank you. How much is it?","model_pt":"Ok, obrigado. Quanto custa?"}],
 "scenario":"You are a pharmacist and later a doctor. The student explains simple symptoms (headache, fever, stomach ache, cold) and asks about medicine.",
 "pt_help":true}$j$::jsonb, true),
('health_02','health','Emergência','Pedir socorro e explicar o que aconteceu.',2,8,2, $j${
 "chunks":[
  {"en":"Help! Call an ambulance!","pt":"Socorro! Chame uma ambulância!"},
  {"en":"I lost my passport.","pt":"Perdi meu passaporte."},
  {"en":"Someone stole my phone.","pt":"Roubaram meu celular."},
  {"en":"Where is the police station?","pt":"Onde fica a delegacia?"},
  {"en":"I need to call my family.","pt":"Preciso ligar para minha família."}],
 "dialog":[
  {"q":"Police. What happened?","q_pt":"Polícia. O que aconteceu?","a":["stole","phone","lost","passport","someone"],"model":"Someone stole my phone.","model_pt":"Roubaram meu celular."},
  {"q":"I'm sorry. Where were you?","q_pt":"Sinto muito. Onde você estava?","a":["i was","at the","near","in the","street","restaurant"],"model":"I was at the restaurant near the hotel.","model_pt":"Eu estava no restaurante perto do hotel."},
  {"q":"OK. Please fill out this form.","q_pt":"Ok. Por favor, preencha este formulário.","a":["ok","need to call","family","thank you","help"],"model":"OK. I need to call my family.","model_pt":"Ok. Preciso ligar para minha família."}],
 "scenario":"You are a police officer helping a tourist. Keep it calm and simple: what happened, where, when, and next steps.",
 "pt_help":true}$j$::jsonb, true),
('social_02','social','Falar de você','Contar de onde é, trabalho e família.',2,10,1, $j${
 "chunks":[
  {"en":"I'm from Brazil.","pt":"Sou do Brasil."},
  {"en":"I work in sales.","pt":"Trabalho com vendas."},
  {"en":"I have two children.","pt":"Tenho dois filhos."},
  {"en":"And you?","pt":"E você?"},
  {"en":"Nice to meet you!","pt":"Prazer em te conhecer!"}],
 "dialog":[
  {"q":"Hi! Where are you from?","q_pt":"Oi! De onde você é?","a":["i'm from","im from","brazil","from"],"model":"I'm from Brazil. And you?","model_pt":"Sou do Brasil. E você?"},
  {"q":"I'm from Canada. What do you do?","q_pt":"Sou do Canadá. O que você faz?","a":["i work","i'm a","im a","work in"],"model":"I work in sales.","model_pt":"Trabalho com vendas."},
  {"q":"Cool! Do you have kids?","q_pt":"Legal! Você tem filhos?","a":["i have","yes","no","children","kids"],"model":"Yes, I have two children.","model_pt":"Sim, tenho dois filhos."}],
 "scenario":"You are a friendly person the student just met. Ask simple personal questions (country, city, job, family, likes) and share about yourself too.",
 "pt_help":true}$j$::jsonb, true),
('business_02','business','Reunião','Concordar, discordar, pedir para repetir e dar opinião.',2,12,3, $j${
 "chunks":[
  {"en":"I agree with you.","pt":"Concordo com você."},
  {"en":"I'm not sure about that.","pt":"Não tenho certeza sobre isso."},
  {"en":"Could you repeat that, please?","pt":"Pode repetir, por favor?"},
  {"en":"In my opinion, ...","pt":"Na minha opinião, ..."},
  {"en":"Let's move on.","pt":"Vamos seguir em frente."}],
 "dialog":[
  {"q":"Let's start. What do you think about the new plan?","q_pt":"Vamos começar. O que acha do novo plano?","a":["i think","in my opinion","i agree","good","i'm not sure","im not sure"],"model":"In my opinion, it's a good plan.","model_pt":"Na minha opinião, é um bom plano."},
  {"q":"We want to start next month and cut costs by ten percent.","q_pt":"Queremos começar mês que vem e cortar custos em dez por cento.","a":["repeat","not sure","agree","sorry"],"model":"Sorry, could you repeat that, please?","model_pt":"Desculpe, pode repetir, por favor?"},
  {"q":"Sure. Next month, ten percent less cost. Do you agree?","q_pt":"Claro. Mês que vem, dez por cento menos custo. Você concorda?","a":["i agree","agree","yes","not sure"],"model":"Yes, I agree with you.","model_pt":"Sim, concordo com você."}],
 "scenario":"You lead a short business meeting. Ask the student's opinion, say numbers and dates, and let them agree, disagree politely or ask you to repeat.",
 "pt_help":true}$j$::jsonb, true),
('business_03','business','Ligação e videochamada','Atender, se apresentar e lidar com áudio ruim.',3,10,2, $j${
 "chunks":[
  {"en":"Hello, this is Ricardo speaking.","pt":"Alô, aqui é o Ricardo."},
  {"en":"Can you hear me?","pt":"Você está me ouvindo?"},
  {"en":"You're on mute.","pt":"Você está no mudo."},
  {"en":"Sorry, the connection is bad.","pt":"Desculpe, a conexão está ruim."},
  {"en":"Can I call you back?","pt":"Posso te ligar de volta?"}],
 "dialog":[
  {"q":"Hello? Hi, this is Sarah from ABC.","q_pt":"Alô? Oi, aqui é a Sarah da ABC.","a":["this is","speaking","hello","hi sarah"],"model":"Hi Sarah, this is Ricardo speaking.","model_pt":"Oi Sarah, aqui é o Ricardo."},
  {"q":"Sorry... I can't hear you very well.","q_pt":"Desculpe... não estou te ouvindo bem.","a":["can you hear","connection","call you back","sorry"],"model":"Sorry, the connection is bad. Can you hear me now?","model_pt":"Desculpe, a conexão está ruim. Me ouve agora?"},
  {"q":"Still bad. Should we try again later?","q_pt":"Ainda ruim. Tentamos mais tarde?","a":["call you back","yes","in five minutes","later","ok"],"model":"Yes. Can I call you back in five minutes?","model_pt":"Sim. Posso te ligar de volta em cinco minutos?"}],
 "scenario":"You are a business contact on a phone or video call. Start the call, have audio problems, and arrange to talk again.",
 "pt_help":true}$j$::jsonb, true),
('business_04','business','Jantar com cliente','Conversa leve com cliente: viagem, cidade, gostos.',4,12,3, $j${
 "chunks":[
  {"en":"How was your trip?","pt":"Como foi sua viagem?"},
  {"en":"Is this your first time in Brazil?","pt":"É sua primeira vez no Brasil?"},
  {"en":"You should try the barbecue.","pt":"Você deveria provar o churrasco."},
  {"en":"Thank you for coming.","pt":"Obrigado por vir."},
  {"en":"It was a pleasure.","pt":"Foi um prazer."}],
 "dialog":[
  {"q":"Thank you for the invitation!","q_pt":"Obrigado pelo convite!","a":["thank you for coming","how was your trip","welcome","pleasure"],"model":"Thank you for coming. How was your trip?","model_pt":"Obrigado por vir. Como foi sua viagem?"},
  {"q":"Long, but good. Everything here looks delicious.","q_pt":"Longa, mas boa. Tudo aqui parece delicioso.","a":["you should try","barbecue","try","first time"],"model":"You should try the barbecue. It's very good.","model_pt":"Você deveria provar o churrasco. É muito bom."},
  {"q":"I will! It was a great evening.","q_pt":"Vou provar! Foi uma ótima noite.","a":["pleasure","it was","thank you","see you"],"model":"It was a pleasure. See you tomorrow!","model_pt":"Foi um prazer. Até amanhã!"}],
 "scenario":"You are a foreign client visiting Brazil, at dinner with the student. Make small talk: trip, city, food, family, hobbies. Avoid heavy business details.",
 "pt_help":true}$j$::jsonb, true)
on conflict (id) do update set module_id = excluded.module_id, title = excluded.title, objective = excluded.objective,
  sort_order = excluded.sort_order, content = excluded.content, active = true;
