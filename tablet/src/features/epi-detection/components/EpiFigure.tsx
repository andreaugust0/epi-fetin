import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

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
 * O corpo vive num sistema de 200×330 e é escalado pelo `viewBox`. As
 * coordenadas abaixo são conferíveis a olho: topo da cabeça y=26, queixo
 * y=94, cintura y=196, chão y=311.
 */
const LARGURA = 200;
const ALTURA = 330;

/**
 * Silhueta base — sempre visível, sempre da mesma cor. É a referência que
 * dá sentido às cores por cima: sem ela, sete manchas soltas não formam
 * uma pessoa.
 */
const Silhueta = ({ cor }: { cor: string }) => (
  <G fill={cor}>
    <Circle cx={100} cy={60} r={34} />
    <Rect x={88} y={88} width={24} height={18} />
    <Rect x={64} y={100} width={72} height={96} rx={20} />
    <Rect x={46} y={104} width={20} height={88} rx={10} />
    <Rect x={134} y={104} width={20} height={88} rx={10} />
    <Circle cx={56} cy={200} r={14} />
    <Circle cx={144} cy={200} r={14} />
    <Rect x={76} y={194} width={20} height={96} rx={10} />
    <Rect x={104} y={194} width={20} height={96} rx={10} />
    <Ellipse cx={82} cy={298} rx={15} ry={11} />
    <Ellipse cx={118} cy={298} rx={15} ry={11} />
  </G>
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
 */
const PECAS: Record<EpiId, ReactNode> = {
  capacete: (
    <>
      <Path d="M 66 60 A 34 34 0 0 1 134 60 Z" />
      <Rect x={62} y={53} width={76} height={10} rx={5} />
    </>
  ),
  oculos: <Rect x={74} y={64} width={52} height={13} rx={6.5} />,
  mascara: <Rect x={78} y={82} width={44} height={16} rx={8} />,
  auricular: (
    <>
      <Rect x={55} y={64} width={12} height={26} rx={6} />
      <Rect x={133} y={64} width={12} height={26} rx={6} />
    </>
  ),
  colete: <Rect x={66} y={104} width={68} height={74} rx={16} />,
  luvas: (
    <>
      <Circle cx={56} cy={200} r={16} />
      <Circle cx={144} cy={200} r={16} />
    </>
  ),
  botas: (
    <>
      <Rect x={75} y={262} width={22} height={30} rx={7} />
      <Rect x={103} y={262} width={22} height={30} rx={7} />
      <Ellipse cx={82} cy={298} rx={16} ry={13} />
      <Ellipse cx={118} cy={298} rx={16} ry={13} />
    </>
  ),
};

/**
 * Ordem de desenho, não de importância: as peças de baixo primeiro, para
 * o capacete ficar por cima da cabeça e as luvas por cima das mãos.
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
        <Silhueta cor={corpo} />
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, estiloPulso]}>
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${LARGURA} ${ALTURA}`}>
          {ORDEM.map((id) => (
            <G
              key={id}
              testID={`epi-figura-${id}`}
              fill={corDe(id)}
              stroke={contorno}
              strokeWidth={3}
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
