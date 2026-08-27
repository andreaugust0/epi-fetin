import { useEffect, useState } from 'react';
import { Icone, ICONE_MARCA } from './basicos';

/**
 * Barra superior do sistema, igual à do totem.
 *
 * No app do totem o indicador mostra se o terminal está conectado. Aqui ele
 * mostra o mesmo, para o mesmo público: se a API e o broker estão de pé.
 * Não é enfeite — quando o painel parar de carregar dados, esta barra diz
 * na hora se o problema é o servidor ou a tela.
 */
interface Saude {
  status: string;
  mqtt: string;
  env: string;
}

const INTERVALO_MS = 10_000;

export function BarraStatus() {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [erro, setErro] = useState(false);
  const [relogio, setRelogio] = useState(() => new Date());

  useEffect(() => {
    let vivo = true;
    const checar = async () => {
      try {
        const r = await fetch('/health');
        if (!r.ok) throw new Error();
        const d = (await r.json()) as Saude;
        if (vivo) {
          setSaude(d);
          setErro(false);
        }
      } catch {
        if (vivo) {
          setErro(true);
          setSaude(null);
        }
      }
    };
    void checar();
    const id = setInterval(checar, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setRelogio(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const conectado = !erro && saude?.mqtt === 'conectado';
  const parcial = !erro && saude !== null && saude.mqtt !== 'conectado';

  const texto = erro
    ? 'Servidor fora do ar'
    : parcial
      ? 'Broker desconectado'
      : conectado
        ? 'Conectado'
        : 'Verificando…';

  return (
    <div className="barra-status">
      <span className="sistema">
        <Icone caminho={ICONE_MARCA} />
        EPI Fetin · Administração
      </span>
      <span className="direita">
        {saude?.env && saude.env !== 'prod' ? (
          <span style={{ textTransform: 'uppercase' }}>{saude.env}</span>
        ) : null}
        <span className={`conexao ${conectado ? 'on' : erro || parcial ? 'off' : ''}`}>
          <span className="ponto" aria-hidden="true" />
          {texto}
        </span>
        <span>{relogio.toLocaleTimeString('pt-BR')}</span>
      </span>
    </div>
  );
}
