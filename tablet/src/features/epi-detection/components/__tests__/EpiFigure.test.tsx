import { render } from '@testing-library/react-native';

import { colors } from '@/theme';

import type { DetectedEpi, EpiId } from '../../types';
import { EpiFigure } from '../EpiFigure';

const epi = (id: EpiId, detected: boolean): DetectedEpi => ({
  id,
  label: id,
  description: '',
  confidence: detected ? 0.9 : 0,
  detected,
});

/**
 * O `react-native-svg` normaliza `fill` antes de guardar na prop: "#22C55E"
 * vira `{ type: 0, payload: 4280468830 }`, que é o ARGB inteiro. Comparar
 * com a string crua falha por um detalhe de serialização, não por cor
 * errada — daí traduzir os dois lados para o mesmo formato.
 */
const paraArgb = (hex: string): number => Number(`0xFF${hex.slice(1)}`);

const corDe = (no: { props: { fill?: unknown } }): number | string | undefined => {
  const fill = no.props.fill;
  if (fill && typeof fill === 'object' && 'payload' in fill) {
    return (fill as { payload: number }).payload;
  }
  return typeof fill === 'string' ? paraArgb(fill) : undefined;
};

describe('EpiFigure', () => {
  it('pinta de verde o que foi detectado e de vermelho o que faltou', async () => {
    const { getByTestId } = await render(
      <EpiFigure items={[epi('capacete', true), epi('luvas', false)]} />,
    );

    expect(corDe(getByTestId('epi-figura-capacete'))).toBe(paraArgb(colors.status.approved));
    expect(corDe(getByTestId('epi-figura-luvas'))).toBe(paraArgb(colors.status.rejected));
  });

  /**
   * A checagem que justifica o componente ser como é.
   *
   * A Raspberry infere e o servidor devolve o desfecho de uma vez só, com
   * todos os EPIs juntos. Não existe o instante em que o capacete já
   * passou e o colete ainda não. Se um verde vazasse para a tela de
   * análise, quem opera leria como aprovação parcial de uma catraca que
   * continua trancada.
   */
  it('nao mostra verde nem vermelho enquanto analisa', async () => {
    const { getByTestId } = await render(
      <EpiFigure items={[epi('capacete', true), epi('luvas', false)]} analyzing />,
    );

    for (const id of ['capacete', 'luvas'] as const) {
      const cor = corDe(getByTestId(`epi-figura-${id}`));
      expect(cor).not.toBe(paraArgb(colors.status.approved));
      expect(cor).not.toBe(paraArgb(colors.status.rejected));
    }
  });

  it('apaga o equipamento que o ponto nao exige', async () => {
    const { getByTestId } = await render(<EpiFigure items={[epi('capacete', true)]} />);

    expect(corDe(getByTestId('epi-figura-capacete'))).toBe(paraArgb(colors.status.approved));
    // Não exigido não é o mesmo que ausente: cinza, não vermelho. Pintar de
    // vermelho um EPI que o ponto não pede acusaria a pessoa de algo que
    // ninguém cobrou dela.
    expect(corDe(getByTestId('epi-figura-luvas'))).toBe(paraArgb(colors.slate[200]));
  });
});
