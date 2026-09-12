// functions/atualizar-estoque.js  (Cloudflare Pages Functions)
//
// Só o curador autenticado (role = 'admin' em profiles) pode chamar isso.
// Atualiza o nível de um tipo sanguíneo num hemocentro e, se o novo nível
// for 'critico' (e o anterior não era), avisa por e-mail todos os doadores
// ativos daquele tipo sanguíneo.
//
// Rota final no Cloudflare Pages: POST /atualizar-estoque
// Variáveis de ambiente necessárias (Settings → Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getUsuarioAutenticado(env, accessToken) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function buscarPerfil(env, userId) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=role,hemocentro_id`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const rows = await resp.json();
  return rows[0] || null;
}

function verificarPermissao(perfil, hemocentroIdAlvo) {
  if (!perfil) return 'Perfil não encontrado';
  if (perfil.role === 'admin') return null; // admin edita qualquer hemocentro
  if (perfil.role === 'editor_hemocentro') {
    if (perfil.hemocentro_id === hemocentroIdAlvo) return null;
    return 'Você só pode atualizar o hemocentro vinculado à sua conta';
  }
  return 'Sem permissão para atualizar o estoque';
}

async function buscarNivelAtual(env, hemocentroId, tipo) {
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/estoque?hemocentro_id=eq.${hemocentroId}&tipo_sanguineo=eq.${encodeURIComponent(tipo)}&select=nivel`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const rows = await resp.json();
  return rows[0] ? rows[0].nivel : null;
}

async function salvarNivel(env, hemocentroId, tipo, nivel) {
  const existente = await buscarNivelAtual(env, hemocentroId, tipo);
  if (existente !== null) {
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/estoque?hemocentro_id=eq.${hemocentroId}&tipo_sanguineo=eq.${encodeURIComponent(tipo)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nivel, atualizado_em: new Date().toISOString() }),
      }
    );
  } else {
    await fetch(`${env.SUPABASE_URL}/rest/v1/estoque`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hemocentro_id: hemocentroId,
        tipo_sanguineo: tipo,
        nivel,
        atualizado_em: new Date().toISOString(),
      }),
    });
  }
}

async function buscarDoadoresAtivos(env, tipo) {
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/doadores?tipo_sanguineo=eq.${encodeURIComponent(tipo)}&ativo=eq.true&select=nome,email`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  return resp.json();
}

async function buscarNomeHemocentro(env, hemocentroId) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/hemocentros?id=eq.${hemocentroId}&select=nome,cidade`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const rows = await resp.json();
  return rows[0] || { nome: 'um hemocentro', cidade: '' };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return jsonResponse(401, { erro: 'Não autenticado' });

  const usuario = await getUsuarioAutenticado(env, authHeader.slice('Bearer '.length));
  if (!usuario || !usuario.id) return jsonResponse(401, { erro: 'Sessão inválida' });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { erro: 'JSON inválido' });
  }

  const { hemocentroId, tipoSanguineo, nivel } = body;
  const NIVEIS_VALIDOS = ['normal', 'baixo', 'critico', 'sem-dado'];
  if (!hemocentroId || !tipoSanguineo || !NIVEIS_VALIDOS.includes(nivel)) {
    return jsonResponse(400, { erro: 'Dados inválidos' });
  }

  const perfil = await buscarPerfil(env, usuario.id);
  const erroPermissao = verificarPermissao(perfil, hemocentroId);
  if (erroPermissao) return jsonResponse(403, { erro: erroPermissao });

  const nivelAnterior = await buscarNivelAtual(env, hemocentroId, tipoSanguineo);
  await salvarNivel(env, hemocentroId, tipoSanguineo, nivel);

  let notificados = 0;

  if (nivel === 'critico' && nivelAnterior !== 'critico') {
    const doadores = await buscarDoadoresAtivos(env, tipoSanguineo);
    const hemo = await buscarNomeHemocentro(env, hemocentroId);
    const origem = new URL(request.url).origin;

    for (const doador of doadores || []) {
      try {
        await fetch(`${origem}/enviar-alerta-doador`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome: doador.nome,
            email: doador.email,
            tipoSanguineo,
            hemocentroNome: hemo.nome,
            hemocentroCidade: hemo.cidade,
          }),
        });
        notificados++;
      } catch (e) {
        console.error('Falha ao notificar doador', doador.email, e);
      }
    }
  }

  return jsonResponse(200, { ok: true, notificados });
        }
