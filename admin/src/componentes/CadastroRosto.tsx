import { useRef, useState } from 'react';
import { mdiAlertOutline, mdiCameraPlusOutline, mdiCheck, mdiClose } from '@mdi/js';
import { api, ErroApi, type Pessoa, type RostoCadastrado } from '../api/cliente';
import { Aviso, Icone, Pastilha } from './basicos';

/**
 * Quantas capturas pedir por pessoa.
 *
 * Três a cinco, em ângulos e iluminações diferentes. Isso melhora bastante
 * o recall sem afrouxar o limiar de distância — que é o ajuste que se faz
 * por engano quando o reconhecimento falha, e que é justamente o que dispara
 * o falso positivo.
 */
const ALVO_CAPTURAS = 3;

/**
 * Acima disto, capturas a mais não melhoram o reconhecimento.
 *
 * A busca no pgvector pega o MELHOR vetor de cada pessoa (`DISTINCT ON`),
 * então vetores extras não atrapalham a identificação — mas também não
 * ajudam, e engordam o índice à toa. O que melhora recall é variedade de
 * ângulo e luz, não repetição.
 */
const MAXIMO_UTIL = 5;

interface Resultado {
  arquivo: string;
  /** Preview local, revogado ao desmontar. */
  url: string;
  estado: 'enviando' | 'ok' | 'erro';
  detalhe?: RostoCadastrado;
  erro?: string;
}

export function CadastroRosto({
  pessoa,
  aoFechar,
  aoCadastrar,
}: {
  pessoa: Pessoa;
  aoFechar: () => void;
  /** Avisa a lista para recontar as biometrias. */
  aoCadastrar: () => void;
}) {
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const cadastradasAgora = resultados.filter((r) => r.estado === 'ok').length;
  const total = pessoa.biometrias + cadastradasAgora;

  async function enviar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setEnviando(true);

    // Uma de cada vez, não em paralelo: cada foto carrega o FaceNet e
    // disputa CPU com a API que atende os tablets. Numa máquina de
    // desenvolvimento, quatro uploads simultâneos derrubam a latência de
    // quem está na catraca.
    for (const arquivo of Array.from(arquivos)) {
      const url = URL.createObjectURL(arquivo);
      const parcial: Resultado = { arquivo: arquivo.name, url, estado: 'enviando' };
      setResultados((r) => [...r, parcial]);

      try {
        const detalhe = await api.cadastrarRosto(pessoa.id, arquivo);
        setResultados((r) =>
          r.map((x) => (x.url === url ? { ...x, estado: 'ok', detalhe } : x)),
        );
        aoCadastrar();
      } catch (e) {
        const erro = e instanceof ErroApi ? e.message : 'Falha ao enviar a foto.';
        setResultados((r) => r.map((x) => (x.url === url ? { ...x, estado: 'erro', erro } : x)));
      }
    }

    setEnviando(false);
    if (entrada.current) entrada.current.value = '';
  }

  // Um só resultado incompatível já é motivo de alerta: significa que o
  // vetor gerado aqui não conversa com o que o tablet gravou.
  const incompativel = resultados.some((r) => r.detalhe?.compativel === false);
  const repetidas = resultados.filter((r) => r.detalhe?.quase_identica).length;

  return (
    <div className="cartao" style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div>
          <b style={{ fontSize: 17, fontWeight: 700 }}>Cadastro facial · {pessoa.nome}</b>
          <p style={{ color: 'var(--slate-500)', fontSize: 13, margin: '4px 0 0' }}>
            {total} captura{total === 1 ? '' : 's'} no total
            {total < ALVO_CAPTURAS
              ? ` — o recomendado são ${ALVO_CAPTURAS}`
              : total > MAXIMO_UTIL
                ? ` — acima de ${MAXIMO_UTIL} não melhora; o que conta é variedade, não quantidade`
                : ''}
          </p>
        </div>
        <button className="pequeno" onClick={aoFechar}>
          <Icone caminho={mdiClose} />
          Fechar
        </button>
      </div>

      {!pessoa.consentimento_vigente ? (
        <Aviso tipo="atencao">
          <b>{pessoa.nome} não tem consentimento vigente.</b> O servidor recusa
          gravar biometria sem ele — registre o consentimento antes de enviar
          fotos.
        </Aviso>
      ) : (
        <Aviso>
          Envie <b>{ALVO_CAPTURAS} fotos de frente</b>, com iluminações e ângulos
          um pouco diferentes. Uma pessoa por foto. A imagem vira um vetor no
          servidor e é <b>descartada na hora</b> — nada de foto fica guardado.
        </Aviso>
      )}

      {incompativel ? (
        <Aviso tipo="erro">
          <b>Este vetor não conversa com os que a pessoa já tinha.</b> Ou a foto
          é de outra pessoa, ou o recorte do rosto aqui saiu diferente do que o
          tablet faz — e nesse caso a catraca não vai reconhecê-la. Confira a
          prévia do recorte abaixo antes de confiar neste cadastro.
        </Aviso>
      ) : null}

      {repetidas > 0 ? (
        <Aviso tipo="atencao">
          <b>
            {repetidas === 1
              ? 'Uma das fotos é praticamente igual'
              : `${repetidas} fotos são praticamente iguais`}{' '}
            a outra já cadastrada.
          </b>{' '}
          Foram gravadas, mas não acrescentam nada: o reconhecimento melhora
          com ângulos e iluminações diferentes, não com repetição. Dez cópias
          da mesma foto dão a mesma informação que uma — e a contagem de
          capturas passa uma confiança que não existe.
        </Aviso>
      ) : null}

      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        disabled={enviando || !pessoa.consentimento_vigente}
        onChange={(e) => void enviar(e.target.files)}
        style={{ display: 'none' }}
      />
      <button
        className="primario"
        onClick={() => entrada.current?.click()}
        disabled={enviando || !pessoa.consentimento_vigente}
      >
        <Icone caminho={mdiCameraPlusOutline} />
        {enviando ? 'Enviando…' : 'Escolher fotos'}
      </button>

      {resultados.length > 0 ? (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
          {resultados.map((r) => (
            <div
              key={r.url}
              style={{
                width: 190,
                border: '1px solid var(--slate-200)',
                borderRadius: 10,
                padding: 10,
                background: 'var(--slate-50)',
              }}
            >
              {/*
                A prévia mostra o RECORTE que o servidor produziu, não a foto
                enviada. É a diferença entre "mandei uma foto" e "o modelo
                mediu este rosto" — e é a única forma de alguém perceber que
                o detector pegou a pessoa do fundo.
              */}
              <img
                src={
                  r.detalhe
                    ? `data:image/png;base64,${r.detalhe.recorte_base64}`
                    : r.url
                }
                alt={`Recorte de ${r.arquivo}`}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  objectFit: 'cover',
                  borderRadius: 8,
                  display: 'block',
                  marginBottom: 8,
                  opacity: r.estado === 'enviando' ? 0.5 : 1,
                }}
              />
              <div style={{ fontSize: 12, wordBreak: 'break-all', marginBottom: 6 }}>
                {r.arquivo}
              </div>

              {r.estado === 'enviando' ? (
                <Pastilha estado="neutro">Analisando…</Pastilha>
              ) : r.estado === 'erro' ? (
                <>
                  <Pastilha estado="alerta">
                    <Icone caminho={mdiAlertOutline} />
                    Recusada
                  </Pastilha>
                  <p style={{ fontSize: 12, color: 'var(--alerta-text)', margin: '6px 0 0' }}>
                    {r.erro}
                  </p>
                </>
              ) : (
                <>
                  <Pastilha estado={r.detalhe?.compativel === false ? 'alerta' : 'ok'}>
                    <Icone caminho={mdiCheck} />
                    Cadastrada
                  </Pastilha>
                  <p style={{ fontSize: 12, color: 'var(--slate-500)', margin: '6px 0 0' }}>
                    detecção {Math.round((r.detalhe?.qualidade ?? 0) * 100)}%
                    {r.detalhe?.distancia_menor != null ? (
                      <>
                        <br />
                        distância {r.detalhe.distancia_menor.toFixed(3)}
                      </>
                    ) : (
                      <>
                        <br />
                        primeira captura
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
