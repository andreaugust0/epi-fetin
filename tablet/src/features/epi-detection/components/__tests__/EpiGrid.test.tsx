import { render } from '@testing-library/react-native';

import { DEFAULT_REQUIRED_EPI_IDS, EPI_CATALOG } from '@/constants/epiCatalog';

import { EpiGrid } from '../EpiGrid';

const ACTIVE = [...DEFAULT_REQUIRED_EPI_IDS];

describe('EpiGrid', () => {
  it('mostra ícone, nome e descrição de todos os equipamentos exigidos', async () => {
    const { getByText, getByLabelText } = await render(
      <EpiGrid activeIds={ACTIVE} showInactive={false} />,
    );

    expect(EPI_CATALOG).toHaveLength(7);

    for (const item of EPI_CATALOG) {
      expect(getByText(item.label)).toBeTruthy();
      expect(getByText(item.description)).toBeTruthy();
      // O rótulo de acessibilidade só existe no item completo, com ícone.
      expect(getByLabelText(new RegExp(`^${item.label}\\.`))).toBeTruthy();
    }
  });

  it('nenhum item colapsa: todos ocupam altura própria', async () => {
    const { getByLabelText } = await render(
      <EpiGrid activeIds={ACTIVE} showInactive={false} />,
    );

    for (const item of EPI_CATALOG) {
      const cell = getByLabelText(new RegExp(`^${item.label}\\.`));
      const style = Array.isArray(cell.props.style)
        ? Object.assign({}, ...cell.props.style.filter(Boolean))
        : (cell.props.style ?? {});

      // `flex: 1` aqui zerava a altura-base no eixo vertical e fazia as
      // linhas colapsarem no Android. A altura tem que vir do conteúdo.
      expect(style.flex).toBeUndefined();
      expect(style.flexBasis).toBeUndefined();
    }
  });

  it('informa quantos equipamentos estão exigidos', async () => {
    const { getByText } = await render(<EpiGrid activeIds={ACTIVE} showInactive={false} />);

    expect(getByText(/^7 /)).toBeTruthy();
  });
});
