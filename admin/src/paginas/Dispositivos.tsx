import { useCallback, useEffect, useState } from 'react';
import {
  mdiContentCopy,
  mdiKeyOutline,
  mdiRefresh,
  mdiTabletDashboard,
} from '@mdi/js';
import { api, ErroApi, type Dispositivo, type Ponto } from '../api/cliente';
import { Aviso, Icone, Pastilha, formatarData } from '../componentes/basicos';

/**
 * Endereço que o tablet deve usar para falar com o servidor.
 *
 * O painel não tem como saber isso com certeza: ele fala com a API por um
 * proxy do Vite (`/api`), então a URL que funciona AQUI quase nunca é a que
 * funciona no tablet. O palpite abaixo troca a porta do painel pela da API
 * e mantém o host — acerta quando o navegador já está acessando o servidor
 * pelo IP da rede, que é o caso comum de quem administra de outra máquina.
 *
 * Quando o palpite sai `localhost`, ele está errado por definição: o
 * `localhost` do tablet é o próprio tablet. É por isso que existe o aviso.
 */
const PORTA_API = 8000;

function palpiteDeEndereco(): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${PORTA_API}`;
}

const ehLocal = (url: string) =>
  /\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);

/** Copia e confirma — sem confirmação, ninguém sabe se funcionou. */
function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      // `clipboard` exige contexto seguro (https ou localhost). Fora dele
      // o botão falha em silêncio, e o operador precisa saber que o
      // caminho é selecionar e copiar à mão.
      setCopiado(false);
      window.prompt(`Copie ${rotulo}:`, texto);
    }
  };

  return (
    <button className="pequeno" onClick={() => void copiar()}>
      <Icone caminho={mdiContentCopy} />
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

const CAIXA = {
  flex: 1,
  display: 'block',
  background: 'var(--slate-50)',
  border: '1px solid var(--slate-200)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  wordBreak: 'break-all' as const,
  lineHeight: 1.5,
};

/**
 * Uma linha do cartão de provisionamento: rótulo, valor e copiar.
 *
 * Com `aoMudar`, o valor vira um campo editável — e continua sendo UM
 * campo. A primeira versão mostrava o valor numa caixa e repetia o mesmo
 * texto num input logo abaixo; quem olhava via a URL duas vezes e não
 * sabia qual das duas o botão Copiar levava.
 */
function Valor({
  rotulo,
  valor,
  nota,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  aoMudar?: (novo: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="overline" style={{ marginBottom: 4 }}>
        {rotulo}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {aoMudar ? (
          <input
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
            aria-label={rotulo}
            className="mono"
            style={{ ...CAIXA, background: 'var(--superficie)' }}
          />
        ) : (
          <code className="mono" style={CAIXA}>
            {valor}
          </code>
        )}
        <BotaoCopiar texto={valor} rotulo={rotulo.toLowerCase()} />
      </div>
      {nota ? (
        <p style={{ color: 'var(--slate-500)', fontSize: 12, margin: '6px 0 0' }}>{nota}</p>
      ) : null}
    </div>
  );
}

export function Dispositivos() {
  const [itens, setItens] = useState<Dispositivo[]>([]);
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [emitindo, setEmitindo] = useState<number | null>(null);
  /** Tokens emitidos nesta sessão da tela, por dispositivo. */
  const [tokens, setTokens] = useState<
    Record<number, { valor: string; expiraEm: string }>
  >({});
  const [endereco, setEndereco] = useState(palpiteDeEndereco);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [d, p] = await Promise.all([api.dispositivos(), api.pontos()]);
      setItens(d);
      setPontos(p);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function emitir(d: Dispositivo) {
    setEmitindo(d.id);
    setErro(null);
    try {
      const t = await api.emitirTokenTablet(d.id);
      setTokens((atual) => ({
        ...atual,
        [d.id]: { valor: t.access_token, expiraEm: t.expira_em },
      }));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao emitir o token.');
    } finally {
      setEmitindo(null);
    }
  }

  const nomeDoPonto = (id: number) => pontos.find((p) => p.id === id)?.nome ?? `ponto ${id}`;
  const pontoDe = (id: number) => pontos.find((p) => p.id === id);

  const tablets = itens.filter((d) => d.tipo === 'TABLET');
  const outros = itens.filter((d) => d.tipo !== 'TABLET');

  return (
    <>
      <div className="cabecalho">
        <div>
          <p className="eyebrow">Configuração</p>
          <h1>Dispositivos</h1>
          <p className="subtitulo">O parque de campo e o provisionamento dos tablets</p>
        </div>
        <button onClick={() => void carregar()} disabled={carregando}>
          <Icone caminho={mdiRefresh} />
          {carregando ? 'Carregando…' : 'Atualizar'}
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <Aviso>
        O token de um tablet <b>carrega o ponto de acesso dentro dele</b>. É isso
        que impede um tablet de abrir verificações num ponto que não é o dele,
        mesmo que alguém altere o corpo da requisição.
      </Aviso>

      <h2>Tablets</h2>
      {tablets.length === 0 ? (
        <div className="cartao">
          <div className="vazio">Nenhum tablet cadastrado.</div>
        </div>
      ) : (
        tablets.map((d) => {
          const token = tokens[d.id];
          const ponto = pontoDe(d.ponto_id);
          return (
            <div className="cartao" key={d.id} style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginBottom: token ? 18 : 0,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icone caminho={mdiTabletDashboard} />
                    <b style={{ fontSize: 17, fontWeight: 700 }}>{nomeDoPonto(d.ponto_id)}</b>
                    <Pastilha estado={d.online ? 'ok' : 'neutro'}>
                      {d.online ? 'Online' : 'Offline'}
                    </Pastilha>
                  </div>
                  <span className="mono">{d.client_id_mqtt}</span>
                  <p style={{ color: 'var(--slate-500)', fontSize: 13, margin: '6px 0 0' }}>
                    Visto em {formatarData(d.visto_em)}
                  </p>
                </div>
                <button
                  className="primario"
                  onClick={() => void emitir(d)}
                  disabled={emitindo === d.id}
                >
                  <Icone caminho={mdiKeyOutline} />
                  {emitindo === d.id
                    ? 'Emitindo…'
                    : token
                      ? 'Emitir outro'
                      : 'Emitir token'}
                </button>
              </div>

              {token ? (
                <div style={{ borderTop: '1px solid var(--slate-200)', paddingTop: 16 }}>
                  <p className="overline" style={{ marginBottom: 12 }}>
                    Cole estes três valores na tela de provisionamento do tablet
                  </p>

                  <Valor
                    rotulo="URL do servidor"
                    valor={endereco}
                    aoMudar={setEndereco}
                    nota="Precisa ser o endereço que o TABLET alcança na rede. Editável — o painel só chuta."
                  />
                  {ehLocal(endereco) ? (
                    <Aviso tipo="atencao">
                      Este endereço aponta para <b>localhost</b>, que no tablet
                      significa o próprio tablet — colar assim não vai conectar.
                      Troque pelo IP desta máquina na rede (algo como
                      <span className="mono"> http://192.168.0.103:8000</span>).
                    </Aviso>
                  ) : null}

                  <Valor
                    rotulo="Ponto de acesso"
                    valor={String(d.ponto_id)}
                    nota={
                      ponto
                        ? `${ponto.codigo} — exige ${
                            ponto.epis_exigidos.length > 0
                              ? ponto.epis_exigidos.join(', ')
                              : 'nenhum EPI (o servidor recusa abrir verificações assim)'
                          }`
                        : undefined
                    }
                  />

                  <Valor
                    rotulo="Token do dispositivo"
                    valor={token.valor}
                    nota={`Vence em ${formatarData(token.expiraEm)}.`}
                  />

                  <Aviso tipo="atencao">
                    O token aparece <b>uma vez só</b>, aqui. Ele não fica guardado
                    em lugar nenhum que dê para consultar depois — se esta tela
                    fechar antes de você colar no tablet, emita outro.
                  </Aviso>
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {outros.length > 0 ? (
        <>
          <h2>Outros dispositivos</h2>
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>Identificador MQTT</th>
                  <th>Tipo</th>
                  <th>Ponto</th>
                  <th>Estado</th>
                  <th>Visto em</th>
                  <th>Firmware</th>
                  <th>Modelo</th>
                </tr>
              </thead>
              <tbody>
                {outros.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.client_id_mqtt}</td>
                    <td>{d.tipo}</td>
                    <td>{nomeDoPonto(d.ponto_id)}</td>
                    <td>
                      <Pastilha estado={d.online ? 'ok' : 'alerta'}>
                        {d.online ? 'Online' : 'Offline'}
                      </Pastilha>
                    </td>
                    <td>{formatarData(d.visto_em)}</td>
                    <td className="mono">{d.firmware ?? '—'}</td>
                    <td className="mono">{d.versao_modelo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
