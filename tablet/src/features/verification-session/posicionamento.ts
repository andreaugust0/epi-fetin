/**
 * Quanto tempo a tela de verificação espera antes de disparar a captura.
 *
 * A marcação do chão fica a alguns passos do tablet, e não por acaso: a câmera
 * da Raspberry precisa do corpo inteiro no quadro, e ninguém cabe inteiro a
 * meio metro da tela. Sem esta pausa, a captura começava com a pessoa ainda
 * debruçada sobre o tablet, e a borda decidia sobre frames de alguém saindo de
 * campo — reprovando quem estava com todos os equipamentos.
 *
 * A espera não é tempo morto, e é por isso que ela não aparece como contagem
 * regressiva. O laço da Raspberry guarda frames continuamente, e a votação
 * acontece sobre os frames mais recentes: os que decidem o resultado são
 * exatamente os capturados durante esta espera. A linha de varredura que corre
 * na tela cobre o intervalo em que a imagem que será julgada está sendo
 * formada — ela não promete nada que não esteja acontecendo.
 *
 * QUANTO a borda olha para trás, exatamente: cinco frames espaçados de 0,2 s,
 * ou seja pouco menos de UM SEGUNDO de história. Os 3 s do anel são o limite
 * de validade — frame mais velho que isso é descartado —, não o tamanho da
 * amostra. Confundir os dois leva a superestimar a espera necessária.
 *
 * Então três segundos bastam: dois de caminhada até a marcação, e o último
 * segundo — o que de fato decide — com a pessoa já parada no lugar.
 *
 * O ajuste existe para o teste, no mesmo padrão das fábricas de serviço deste
 * projeto: esperar os segundos de verdade faria cada teste do fluxo estourar
 * o limite do `waitFor`, e aumentar esse limite deixaria a suíte lenta para
 * medir uma pausa que não é o objeto do teste.
 */
const PADRAO_MS = 3000;

let esperaMs = PADRAO_MS;

export const esperaPosicionamentoMs = (): number => esperaMs;

/** Passe `null` para voltar ao valor de produção. */
export const setEsperaPosicionamentoMs = (ms: number | null): void => {
  esperaMs = ms ?? PADRAO_MS;
};
