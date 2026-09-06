import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme';

import type { DetectedEpi, EpiId } from '../types';


export interface EpiFigureProps {
  /** Os EPIs avaliados. Quem não estiver aqui não é exigido e fica apagado. */
  items: readonly DetectedEpi[];
  /**
   * Verdadeiro enquanto a Raspberry analisa: todas as marcações ficam
   * neutras e pulsando.
   */
  analyzing?: boolean;
  tone?: 'light' | 'dark';
  /**
   * Cor do fundo atrás do boneco. Serve de contorno entre peças vizinhas —
   * sem ela, capacete, óculos e máscara viram uma mancha verde só quando
   * os três estão presentes.
   */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * O corpo vive num sistema de 200×372 e é escalado pelo `viewBox`. As
 * coordenadas são conferíveis a olho: topo da cabeça y=8, queixo y=76,
 * ombros y=86, virilha y=242, chão y=352.
 */
const LARGURA = 200;
const ALTURA = 372;

/**
 * Silhueta base, no desenho do pictograma de sinalização — a mesma figura
 * de placa de banheiro e de saída de emergência.
 *
 * A primeira versão era feita de blocos separados: cabeça, tronco, dois
 * braços, duas pernas, mãos e pés como círculos soltos. Lia como um robô.
 * Aqui os braços não são peças à parte: eles fazem parte do mesmo bloco de
 * ombros, e o que os separa do tronco são duas FENDAS pintadas na cor do
 * fundo. É esse detalhe que faz a figura parecer uma pessoa em vez de um
 * boneco montado.
 *
 * Por isso `fundo` é obrigatório aqui: as fendas não são transparência,
 * são tinta da cor de trás. Num fundo diferente do informado elas
 * apareceriam como riscos.
 */
const Silhueta = ({ cor, fundo }: { cor: string; fundo: string }) => (
  <>
    <G fill={cor}>
      <Circle cx={100} cy={42} r={34} />
      <Rect x={38} y={86} width={124} height={140} rx={30} />
      <Rect x={74} y={122} width={52} height={130} />
      <Rect x={74} y={242} width={23} height={110} rx={11} />
      <Rect x={103} y={242} width={23} height={110} rx={11} />
    </G>
    <G fill={fundo}>
      <Rect x={68} y={120} width={6} height={110} />
      <Rect x={126} y={120} width={6} height={110} />
      <Rect x={97} y={240} width={6} height={30} />
    </G>
  </>
);

/**
 * Cada EPI desenhado no lugar anatômico onde ele é usado.
 *
 * A alternativa seria pendurar sete ícones em volta do boneco, ligados ao
 * corpo por linhas. Foi o primeiro desenho e foi descartado: com quatro
 * equipamentos na cabeça — capacete, óculos, máscara e auricular — as
 * linhas se cruzam, e a leitura à distância, que é a única que importa
 * numa catraca, vira quebra-cabeça. Pintando a peça no lugar dela, "o que
 * está vermelho" se responde sem ler nada.
 *
 * Luvas e botas aproveitam a forma do pictograma em vez de acrescentar
 * peças: são a ponta do braço e a ponta da perna, pintadas. Uma mão
 * desenhada à parte destoaria de uma figura que não tem mãos.
 */
const PECAS: Record<EpiId, ReactNode> = {
  capacete: (
    <>
      <Path d="M 66 42 A 34 34 0 0 1 134 42 Z" />
      <Rect x={60} y={35} width={80} height={10} rx={5} />
    </>
  ),
  oculos: <Rect x={76} y={48} width={48} height={13} rx={6.5} />,
  mascara: <Rect x={80} y={63} width={40} height={15} rx={7.5} />,
  auricular: (
    <>
      <Rect x={61} y={46} width={13} height={26} rx={6.5} />
      <Rect x={126} y={46} width={13} height={26} rx={6.5} />
    </>
  ),
  colete: <Rect x={74} y={102} width={52} height={106} rx={8} />,
  luvas: (
    <>
      <Rect x={38} y={180} width={30} height={46} rx={15} />
      <Rect x={132} y={180} width={30} height={46} rx={15} />
    </>
  ),
  botas: (
    <>
      <Rect x={74} y={302} width={23} height={50} rx={11} />
      <Rect x={103} y={302} width={23} height={50} rx={11} />
    </>
  ),
};

/**
 * Ordem de desenho, não de importância: as de baixo primeiro, para o
 * capacete cobrir o topo da cabeça e os óculos cobrirem a máscara.
 */
const ORDEM: readonly EpiId[] = [
  'botas',
  'luvas',
  'colete',
  'auricular',
  'mascara',
  'oculos',
  'capacete',
];

/**
 * Boneco com os EPIs marcados em verde ou vermelho.
 *
 * Durante a verificação todas as peças ficam neutras e pulsando, e isso é
 * honestidade e não preguiça: a Raspberry infere e o servidor devolve o
 * desfecho de uma vez só, com os sete equipamentos juntos. Não existe o
 * instante em que o capacete já foi aprovado e o colete ainda não —
 * pintar um de verde antes do outro inventaria um progresso que não
 * aconteceu.
 */
export const EpiFigure = ({
  items,
  analyzing = false,
  tone = 'light',
  backgroundColor,
  style,
}: EpiFigureProps) => {
  const pulso = useSharedValue(1);
  const escuro = tone === 'dark';

  useEffect(() => {
    if (!analyzing) {
      pulso.value = 1;
      return;
    }
    pulso.value = withRepeat(
      withTiming(0.4, { duration: 950, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [analyzing, pulso]);

  const estiloPulso = useAnimatedStyle(() => ({ opacity: pulso.value }));

  const corpo = escuro ? colors.slate[700] : colors.slate[300];
  const neutro = escuro ? colors.slate[500] : colors.slate[400];
  const apagado = escuro ? colors.slate[800] : colors.slate[200];
  const contorno = backgroundColor ?? (escuro ? colors.scanner.background : colors.slate[50]);

  const porId = new Map(items.map((item) => [item.id, item]));

  const corDe = (id: EpiId): string => {
    const item = porId.get(id);
    if (!item) {
      return apagado;
    }
    if (analyzing) {
      return neutro;
    }
    return item.detected ? colors.status.approved : colors.status.rejected;
  };

  return (
    <View style={[styles.container, style]} pointerEvents="none">
      {/*
        Duas camadas empilhadas, e nenhuma troca de tipo em tempo de
        execução. É deliberado: foi exatamente uma troca de componente na
        posição 0 de um contêiner que derrubou o app com `addViewAt … The
        specified child already has a parent`. Aqui só mudam cor e
        opacidade — a árvore nativa fica parada.
      */}
      <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${LARGURA} ${ALTURA}`}>
        <Silhueta cor={corpo} fundo={contorno} />
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, estiloPulso]}>
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${LARGURA} ${ALTURA}`}>
          {ORDEM.map((id) => (
            <G
              key={id}
              testID={`epi-figura-${id}`}
              fill={corDe(id)}
              stroke={contorno}
              strokeWidth={2.5}
            >
              {PECAS[id]}
            </G>
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    aspectRatio: LARGURA / ALTURA,
    alignSelf: 'center',
  },
});
