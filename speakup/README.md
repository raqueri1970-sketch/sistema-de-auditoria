# SpeakUp IA

Professor particular de inglês por voz (PWA). Método: ouvir → repetir → entender → responder → conversar.

- App: `speakup/index.html`, publicado pelo Vercel em https://sistema-de-auditoria-omega.vercel.app/speakup/
- API: edge function `speakup-api` no projeto Supabase **Mapa da mima** (`tazyeczbbgspqbyluynf`), schema `english_ai`.
- `english-ai-app` (mesmo projeto) só redireciona para o app.
- Migrações em `speakup/supabase/migrations` (aplicadas no Mapa da mima, não no projeto da auditoria).

## Ligar a conversa com IA (grátis)

1. Crie uma chave gratuita em https://aistudio.google.com/apikey
2. No Supabase (projeto Mapa da mima) → Edge Functions → Secrets, adicione `GEMINI_API_KEY` com a chave.
3. Opcional, reserva grátis: chave do https://console.groq.com em `GROQ_API_KEY`.

Sem chave, as aulas (ouvir, repetir, responder, revisão) funcionam normalmente; só a conversa livre com IA fica desligada.
Limites diários (protegem a cota grátis) ficam na flag `english_ai.feature_flags` → `ai_conversation`.
