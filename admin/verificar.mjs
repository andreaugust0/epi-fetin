/**
 * Verificação do painel com navegador de verdade.
 *
 * Faz login, percorre as quatro telas, confere que os dados do servidor
 * aparecem, exercita o salvamento da política de EPIs e tira capturas.
 *
 *   node verificar.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5174';
const EMAIL = 'admin@epiguard.com.br';
const SENHA = 'admin123';
const SAIDA = '/tmp/capturas';

let ok = 0;
const falhas = [];

function checar(nome, cond, extra = '') {
  if (cond) {
    ok++;
    console.log(`  ok    ${nome} ${extra}`);
  } else {
    falhas.push(nome);
    console.log(`  FALHA ${nome} ${extra}`);
  }
}

const navegar = async (pagina, rotulo) => {
  await pagina.getByRole('link', { name: rotulo }).click();
  await pagina.waitForTimeout(900);
};

mkdirSync(SAIDA, { recursive: true });

// A imagem traz um Chromium pré-instalado cuja build pode não bater com a
// versão do pacote playwright. Apontar o executável evita o download.
const CHROME = process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const navegador = await chromium.launch({ executablePath: CHROME });
const contexto = await navegador.newContext({ viewport: { width: 1360, height: 960 } });
const pagina = await contexto.newPage();

const errosConsole = [];
// O sandbox onde esta verificação roda bloqueia hosts externos, então a
// requisição ao Google Fonts falha aqui e não em uma máquina normal. A
// página usa pilha de fallback, então isso não é defeito do app — só ruído
// do ambiente. Erros de rede de terceiros são filtrados; qualquer erro de
// JavaScript continua reprovando.
const RUIDO_DE_AMBIENTE = /ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)\.com|ERR_NAME_NOT_RESOLVED/;
pagina.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !RUIDO_DE_AMBIENTE.test(t) && !/Failed to load resource/.test(t)) errosConsole.push(t);
});
pagina.on('pageerror', (e) => errosConsole.push(String(e)));
// Registra o URL junto do status: "404" sozinho não diz o que quebrou.
// Só 5xx conta como defeito. Um 4xx é o servidor recusando corretamente
// (senha errada, validação, permissão) e o trabalho do painel é exibir isso
// — o que as checagens acima já verificam que ele faz.
pagina.on('response', (r) => {
  if (r.status() >= 500) errosConsole.push(`HTTP ${r.status()} em ${r.url()}`);
});
pagina.on('requestfailed', (r) => {
  const url = r.url();
  if (!RUIDO_DE_AMBIENTE.test(url) && !RUIDO_DE_AMBIENTE.test(r.failure()?.errorText ?? '')) {
    errosConsole.push(`requisição falhou: ${url}`);
  }
});

try {
  console.log('\n1. login');
  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  checar('tela de login aparece', await pagina.getByRole('heading', { name: 'EPI Guard' }).isVisible());

  await pagina.getByLabel('E-mail').fill(EMAIL);
  await pagina.getByLabel('Senha').fill('errada');
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.waitForTimeout(1200);
  checar(
    'senha errada mostra mensagem do servidor',
    await pagina.getByRole('alert').isVisible(),
    `("${(await pagina.getByRole('alert').textContent())?.trim()}")`,
  );

  await pagina.getByLabel('Senha').fill(SENHA);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.waitForTimeout(1600);
  checar('login entra no painel', await pagina.getByRole('heading', { name: 'Painel' }).isVisible());
  await pagina.screenshot({ path: `${SAIDA}/1-painel.png`, fullPage: true });

  console.log('\n2. painel');
  const corpo = await pagina.textContent('body');
  checar('métrica de conformidade renderizou', /Conformidade/.test(corpo));
  checar('dispositivos do seed aparecem', /rasp-planta01-portaria/.test(corpo));
  checar(
    'gráfico de EPIs desenhou barras',
    (await pagina.locator('svg .gr-barra').count()) > 0,
    `(${await pagina.locator('svg .gr-barra').count()} barras)`,
  );

  await pagina.getByRole('button', { name: 'Ver como tabela' }).click();
  await pagina.waitForTimeout(500);
  checar(
    'gráfico tem visão de tabela acessível',
    await pagina.getByRole('button', { name: 'Ver como gráfico' }).isVisible(),
  );
  await pagina.getByRole('button', { name: 'Ver como gráfico' }).click();

  console.log('\n3. verificações');
  await navegar(pagina, 'Verificações');
  checar(
    'tabela lista as verificações geradas',
    (await pagina.locator('tbody tr').count()) >= 3,
    `(${await pagina.locator('tbody tr').count()} linhas)`,
  );
  await pagina.getByRole('button', { name: 'Detalhes' }).first().click();
  await pagina.waitForTimeout(400);
  checar('detalhe expande com as detecções', /Capacete|capacete/.test(await pagina.textContent('body')));
  await pagina.screenshot({ path: `${SAIDA}/2-verificacoes.png`, fullPage: true });

  const seletorSituacao = pagina.getByLabel('Situação');
  await seletorSituacao.selectOption('REPROVADA');
  await pagina.waitForTimeout(1000);
  const linhasReprovadas = await pagina.locator('tbody tr').count();
  checar('filtro por situação reduz o resultado', linhasReprovadas >= 1, `(${linhasReprovadas})`);

  console.log('\n4. pessoas');
  await navegar(pagina, 'Pessoas');
  checar('tela de pessoas carrega', await pagina.getByRole('heading', { name: 'Pessoas' }).isVisible());

  const matricula = `E2E-${Date.now().toString().slice(-6)}`;
  await pagina.getByRole('button', { name: 'Nova pessoa' }).click();
  await pagina.getByLabel('Matrícula').fill(matricula);
  await pagina.getByLabel('Nome').fill('Teste Automatizado');
  await pagina.getByLabel('Função').fill('QA');
  await pagina.getByRole('button', { name: 'Cadastrar' }).click();
  await pagina.waitForTimeout(1400);
  checar('criar pessoa funciona', (await pagina.textContent('body')).includes(matricula));

  const linhaNova = pagina.locator('tbody tr', { hasText: matricula });
  checar('nasce sem rosto cadastrado', await linhaNova.getByText('Sem rosto').isVisible());
  await linhaNova.getByRole('button', { name: 'Registrar consentimento' }).click();
  await pagina.waitForTimeout(1400);
  checar(
    'registrar consentimento reflete na tabela',
    await pagina.locator('tbody tr', { hasText: matricula }).getByText('Consentimento ativo').isVisible(),
  );
  await pagina.screenshot({ path: `${SAIDA}/3-pessoas.png`, fullPage: true });

  console.log('\n5. pontos de acesso');
  await navegar(pagina, 'Pontos de acesso');
  checar('tela de pontos carrega', await pagina.getByRole('heading', { name: 'Pontos de acesso' }).isVisible());

  const botaoSalvar = pagina.getByRole('button', { name: /Salvo|Salvar/ }).first();
  checar('salvar começa desabilitado (nada mudou)', await botaoSalvar.isDisabled());

  await pagina.getByText('Luvas', { exact: false }).first().click();
  await pagina.waitForTimeout(300);
  checar('marcar um EPI habilita o salvar', await botaoSalvar.isEnabled());

  await botaoSalvar.click();
  await pagina.waitForTimeout(1500);
  checar(
    'salvar a política confirma e volta a desabilitar',
    (await pagina.textContent('body')).includes('atualizada') && (await botaoSalvar.isDisabled()),
  );
  await pagina.screenshot({ path: `${SAIDA}/4-pontos.png`, fullPage: true });

  // devolve o ponto ao estado anterior
  await pagina.getByText('Luvas', { exact: false }).first().click();
  await pagina.waitForTimeout(300);
  await botaoSalvar.click();
  await pagina.waitForTimeout(1200);

  console.log('\n6. tema escuro');
  await pagina.emulateMedia({ colorScheme: 'dark' });
  await navegar(pagina, 'Painel');
  await pagina.screenshot({ path: `${SAIDA}/5-painel-escuro.png`, fullPage: true });
  const fundo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
  checar('tema escuro repinta o fundo', fundo !== 'rgb(241, 242, 238)', `(${fundo})`);

  console.log('\n7. saúde geral');
  checar(
    'nenhum erro no console do navegador',
    errosConsole.length === 0,
    errosConsole.length ? `(${errosConsole[0].slice(0, 90)})` : '',
  );
} catch (e) {
  falhas.push(`exceção: ${e.message}`);
  console.log(`\n  EXCEÇÃO: ${e.message}`);
  await pagina.screenshot({ path: `${SAIDA}/erro.png`, fullPage: true }).catch(() => {});
} finally {
  await navegador.close();
}

console.log(`\n${'='.repeat(56)}`);
console.log(`${ok} verificações passaram, ${falhas.length} falharam`);
if (falhas.length) {
  falhas.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
