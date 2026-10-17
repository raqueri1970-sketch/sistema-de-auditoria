// O SpeakUp IA agora roda como PWA no Vercel (o Supabase não serve HTML pelas edge functions).
const APP = "https://sistema-de-auditoria-omega.vercel.app/speakup/";
Deno.serve(() => new Response(null, { status: 302, headers: { Location: APP, "Cache-Control": "no-store" } }));
