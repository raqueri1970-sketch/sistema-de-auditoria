-- SpeakUp IA: situações pedidas pelo Ricardo que faltavam (números e dinheiro, transporte).
insert into english_ai.lessons (id, module_id, title, objective, sort_order, estimated_minutes, difficulty, content, active) values
('survival_03','survival','Números e dinheiro','Entender preços, quantidades e pagar.',3,10,1, $j${
 "chunks":[
  {"en":"How much is it?","pt":"Quanto custa?"},
  {"en":"It's ten dollars.","pt":"Custa dez dólares."},
  {"en":"Two coffees, please.","pt":"Dois cafés, por favor."},
  {"en":"Can I pay in cash?","pt":"Posso pagar em dinheiro?"},
  {"en":"Keep the change.","pt":"Pode ficar com o troco."}],
 "dialog":[
  {"q":"Hi! What can I get you?","q_pt":"Oi! O que vai querer?","a":["two coffees","one coffee","coffee","i want","can i have"],"model":"Two coffees, please.","model_pt":"Dois cafés, por favor."},
  {"q":"That's eight fifty.","q_pt":"Dá oito e cinquenta.","a":["how much","cash","card","can i pay","here you are","ok"],"model":"Can I pay in cash?","model_pt":"Posso pagar em dinheiro?"},
  {"q":"Sure. Here is your change.","q_pt":"Claro. Aqui está o seu troco.","a":["keep the change","thank you","thanks"],"model":"Thank you! Keep the change.","model_pt":"Obrigado! Pode ficar com o troco."}],
 "scenario":"You are a cashier at a coffee shop. Use simple prices and quantities (numbers 1 to 100, dollars and cents) so the student practices understanding numbers and paying.",
 "pt_help":true}$j$::jsonb, true),
('travel_04','travel','Transporte','Pegar táxi, ônibus e metrô.',4,12,2, $j${
 "chunks":[
  {"en":"Where is the bus stop?","pt":"Onde fica o ponto de ônibus?"},
  {"en":"To the airport, please.","pt":"Para o aeroporto, por favor."},
  {"en":"How long does it take?","pt":"Quanto tempo leva?"},
  {"en":"One ticket to downtown, please.","pt":"Uma passagem para o centro, por favor."},
  {"en":"Can you stop here, please?","pt":"Pode parar aqui, por favor?"}],
 "dialog":[
  {"q":"Hi! Where to?","q_pt":"Oi! Para onde?","a":["to the","airport","hotel","downtown","please"],"model":"To the airport, please.","model_pt":"Para o aeroporto, por favor."},
  {"q":"Sure. Anything else?","q_pt":"Claro. Mais alguma coisa?","a":["how long","how much","no thank you","no"],"model":"How long does it take?","model_pt":"Quanto tempo leva?"},
  {"q":"About twenty minutes. Here we are!","q_pt":"Uns vinte minutos. Chegamos!","a":["stop here","thank you","how much","thanks"],"model":"Can you stop here, please? Thank you!","model_pt":"Pode parar aqui, por favor? Obrigado!"}],
 "scenario":"You are a taxi driver and later a ticket seller at a subway station. The student practices asking for directions, time and tickets.",
 "pt_help":true}$j$::jsonb, true)
on conflict (id) do update set content = excluded.content, title = excluded.title, objective = excluded.objective;
