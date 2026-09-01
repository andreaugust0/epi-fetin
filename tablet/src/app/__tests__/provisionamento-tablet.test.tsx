import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { deviceTokenStore } from '@/features/face-recognition/services/deviceTokenStore';
import { faceApiOverrideStore } from '@/features/face-recognition/services/faceApiOverrideStore';
import ProvisionamentoTabletScreen from '@/app/provisionamento-tablet';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@/features/face-recognition/services/deviceTokenStore', () => ({
  deviceTokenStore: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockedGet = deviceTokenStore.get as jest.MockedFunction<typeof deviceTokenStore.get>;
const mockedSet = deviceTokenStore.set as jest.MockedFunction<typeof deviceTokenStore.set>;
const mockedRemove = deviceTokenStore.remove as jest.MockedFunction<typeof deviceTokenStore.remove>;

/** Nunca um JWT real — só uma string de teste estruturalmente válida. */
const FAKE_JWT = 'aaa.bbb.ccc';

describe('ProvisionamentoTabletScreen — token do dispositivo', () => {
  beforeEach(async () => {
    mockedGet.mockReset();
    mockedSet.mockReset();
    mockedRemove.mockReset();
    await AsyncStorage.clear();
  });

  it('mostra "Não provisionado" quando o store devolve null', async () => {
    mockedGet.mockResolvedValueOnce(null);

    const { findByText } = await render(<ProvisionamentoTabletScreen />);

    expect(await findByText('Não provisionado')).toBeTruthy();
  });

  it('mostra "Provisionado" quando o store possui um valor fake', async () => {
    mockedGet.mockResolvedValueOnce(FAKE_JWT);

    const { findByText, queryByText } = await render(<ProvisionamentoTabletScreen />);

    expect(await findByText('Provisionado')).toBeTruthy();
    expect(queryByText(FAKE_JWT)).toBeNull();
  });

  it('nunca renderiza o conteúdo do token salvo em nenhum lugar da tela', async () => {
    mockedGet.mockResolvedValueOnce(FAKE_JWT);

    const { findByText, toJSON } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Provisionado');

    expect(JSON.stringify(toJSON())).not.toContain(FAKE_JWT);
  });

  it('rejeita token vazio: mostra erro e não chama deviceTokenStore.set()', async () => {
    mockedGet.mockResolvedValueOnce(null);

    const { findByText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.press(getByText('Salvar token'));
    });

    expect(mockedSet).not.toHaveBeenCalled();
    expect(await findByText(/Token inválido/)).toBeTruthy();
  });

  it('rejeita formato claramente inválido e mostra erro, sem chamar o store', async () => {
    mockedGet.mockResolvedValueOnce(null);

    const { findByText, getByPlaceholderText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('Cole o JWT do dispositivo aqui'), 'nao-e-um-jwt');
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar token'));
    });

    expect(mockedSet).not.toHaveBeenCalled();
    expect(await findByText(/Token inválido/)).toBeTruthy();
  });

  it('aceita um JWT fake estruturalmente válido, chama deviceTokenStore.set() e limpa o campo', async () => {
    mockedGet.mockResolvedValueOnce(null).mockResolvedValueOnce(FAKE_JWT);
    mockedSet.mockResolvedValueOnce();

    const { findByText, getByPlaceholderText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    const input = getByPlaceholderText('Cole o JWT do dispositivo aqui');
    await act(async () => {
      fireEvent.changeText(input, FAKE_JWT);
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar token'));
    });

    expect(mockedSet).toHaveBeenCalledWith(FAKE_JWT);
    expect(await findByText('Token salvo com sucesso.')).toBeTruthy();

    await waitFor(() => {
      expect(input.props.value).toBe('');
    });
  });

  it('remove o token chamando deviceTokenStore.remove()', async () => {
    mockedGet.mockResolvedValueOnce(FAKE_JWT).mockResolvedValueOnce(null);
    mockedRemove.mockResolvedValueOnce();

    const { findByText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Provisionado');

    await act(async () => {
      fireEvent.press(getByText('Remover token'));
    });

    expect(mockedRemove).toHaveBeenCalledTimes(1);
    expect(await findByText('Não provisionado')).toBeTruthy();
  });

  it('nunca imprime o token digitado em console.log/console.error', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedGet.mockResolvedValueOnce(null).mockResolvedValueOnce(FAKE_JWT);
    mockedSet.mockResolvedValueOnce();

    const { findByText, getByPlaceholderText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('Cole o JWT do dispositivo aqui'), FAKE_JWT);
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar token'));
    });

    const loggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    expect(loggedArgs).not.toContain(FAKE_JWT);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('ProvisionamentoTabletScreen — configuração de URL/ponto (override local)', () => {
  beforeEach(async () => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue(null);
    await AsyncStorage.clear();
  });

  it('sem override e sem env: mostra "Não configurada" para API e Ponto', async () => {
    const { findAllByText } = await render(<ProvisionamentoTabletScreen />);

    expect((await findAllByText('Não configurada')).length).toBeGreaterThanOrEqual(2);
  });

  it('override salvo previamente é exibido ao abrir a tela', async () => {
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 1 });

    const { findByText } = await render(<ProvisionamentoTabletScreen />);

    expect(await findByText(/192\.168\.0\.10:8000/)).toBeTruthy();
  });

  it('rejeita URL inválida e não grava o override', async () => {
    const { findByText, getByPlaceholderText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('http://192.168.0.10:8000'), 'nao-e-uma-url');
    });
    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('ponto_id (ex.: 1)'), '1');
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar configuração'));
    });

    expect(await findByText(/URL inválida/)).toBeTruthy();
    await expect(faceApiOverrideStore.get()).resolves.toBeNull();
  });

  it('rejeita ponto_id inválido e não grava o override', async () => {
    const { findByText, getByPlaceholderText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('http://192.168.0.10:8000'), 'http://192.168.0.10:8000');
    });
    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('ponto_id (ex.: 1)'), 'zero');
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar configuração'));
    });

    expect(await findByText(/Ponto de acesso inválido/)).toBeTruthy();
    await expect(faceApiOverrideStore.get()).resolves.toBeNull();
  });

  it('salva URL e ponto válidos e passa a exibi-los como "definida neste tablet"', async () => {
    const { findByText, findAllByText, getByPlaceholderText, getByText } = await render(
      <ProvisionamentoTabletScreen />,
    );
    await findByText('Não provisionado');

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('http://192.168.0.10:8000'), 'http://172.20.10.3:8000');
    });
    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('ponto_id (ex.: 1)'), '1');
    });
    await act(async () => {
      fireEvent.press(getByText('Salvar configuração'));
    });

    expect(await findByText('Configuração salva neste tablet.')).toBeTruthy();
    await expect(faceApiOverrideStore.get()).resolves.toEqual({
      baseUrl: 'http://172.20.10.3:8000',
      pointId: 1,
    });
    expect((await findAllByText(/definida neste tablet/)).length).toBe(2);
  });

  it('restaurar padrão remove o override', async () => {
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 1 });

    const { findByText, getByText } = await render(<ProvisionamentoTabletScreen />);
    await findByText(/192\.168\.0\.10:8000/);

    await act(async () => {
      fireEvent.press(getByText('Restaurar padrão'));
    });

    expect(await findByText('Override removido — voltou ao padrão da build.')).toBeTruthy();
    await expect(faceApiOverrideStore.get()).resolves.toBeNull();
  });
});
