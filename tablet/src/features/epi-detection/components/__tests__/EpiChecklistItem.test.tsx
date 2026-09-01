import { render } from '@testing-library/react-native';

import type { DetectedEpi } from '../../types';
import { EpiChecklistItem } from '../EpiChecklistItem';

const detectedItem: DetectedEpi = {
  id: 'capacete',
  label: 'Capacete',
  description: 'Proteção da cabeça',
  confidence: 0.97,
  detected: true,
};

describe('EpiChecklistItem', () => {
  it('comunica o estado por texto, não apenas por cor', async () => {
    const { getByText } = await render(<EpiChecklistItem item={detectedItem} />);

    expect(getByText('Detectado · Proteção da cabeça')).toBeTruthy();
  });

  it('indica quando o equipamento não foi detectado', async () => {
    const { getByText } = await render(
      <EpiChecklistItem item={{ ...detectedItem, detected: false, confidence: 0.2 }} />,
    );

    expect(getByText('Não detectado · Proteção da cabeça')).toBeTruthy();
    expect(getByText('20%')).toBeTruthy();
  });

  it('descreve o item para leitores de tela', async () => {
    const { getByLabelText } = await render(<EpiChecklistItem item={detectedItem} />);

    expect(getByLabelText('Capacete. Detectado. Confiança 97%.')).toBeTruthy();
  });
});
