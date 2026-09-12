// functions/enviar-alerta-doador.js  (Cloudflare Pages Functions)
//
// Envia o e-mail de alerta para um doador quando o tipo sanguíneo dele fica
// crítico em algum hemocentro. Chamada internamente por atualizar-estoque.js
// — não é pública.
//
// O Cloudflare Pages não tem a extensão "Emails" que o Netlify tinha, então
// aqui chamamos a API do SendGrid diretamente.
//
// Variável de ambiente necessária: SENDGRID_API_KEY
// (Cloudflare Pages → Settings → Environment variables → marcar como "Secret")
//
// IMPORTANTE: o remetente "alertas@sanguesp.com.br" precisa estar verificado
// no SendGrid (Settings → Sender Authentication) antes do primeiro envio,
// senão o SendGrid recusa a mensagem.

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function montarHtml({ nome, tipoSanguineo, hemocentroNome, hemocentroCidade }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background:#f7f6f5; padding:24px; color:#201c1b;">
  <div style="max-width:480px; margin:0 auto; background:#fff; border-radius:12px; padding:24px; border:1px solid #e7e3e1;">
    <h2 style="color:#b3122b; margin-top:0;">🩸 Seu tipo sanguíneo está em falta</h2>
    <p>Olá ${nome || ''},</p>
    <p>
      O tipo sanguíneo <strong>${tipoSanguineo}</strong> está em nível
      <strong>crítico</strong> no <strong>${hemocentroNome}</strong>
      (${hemocentroCidade || ''}).
    </p>
    <p>Se puder doar nos próximos dias, você pode ajudar a salvar vidas de verdade.</p>
    <p style="font-size:12px; color:#766f6c; margin-top:32px;">
      Você está recebendo este e-mail porque se cadastrou no SangueBR como doador de ${tipoSanguineo}.
    </p>
  </div>
</body>
</html>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { erro: 'JSON inválido' });
  }

  const { nome, email, tipoSanguineo, hemocentroNome, hemocentroCidade } = body;
  if (!email || !tipoSanguineo || !hemocentroNome) {
    return jsonResponse(400, { erro: 'Dados incompletos' });
  }

  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'alertas@sanguesp.com.br', name: 'SangueBR' },
        subject: `🩸 Seu tipo (${tipoSanguineo}) está em falta perto de você`,
        content: [{ type: 'text/html', value: montarHtml({ nome, tipoSanguineo, hemocentroNome, hemocentroCidade }) }],
      }),
    });

    if (!resp.ok) {
      const erro = await resp.text();
      console.error('Erro do SendGrid:', erro);
      return jsonResponse(502, { erro: 'Falha ao enviar e-mail' });
    }

    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error('Erro ao enviar alerta', e);
    return jsonResponse(502, { erro: 'Falha ao enviar e-mail' });
  }
                             }
