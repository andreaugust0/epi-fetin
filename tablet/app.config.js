/**
 * Variante de instalação, aplicada por cima do `app.json`.
 *
 * O Expo passa o conteúdo do `app.json` como `config`; aqui só mudamos o que
 * distingue uma variante da outra. O `app.json` continua sendo a fonte da
 * verdade — sem `APP_VARIANT` definido, este arquivo devolve a configuração
 * intacta, e o build de produção sai exatamente como saía antes.
 *
 * Por que existir: o build de desenvolvimento carrega o JavaScript do Metro,
 * o de produção carrega o que foi assado dentro dele. Com o mesmo
 * `android.package`, instalar um apagaria o outro — e chegar na portaria com
 * o build que depende de um notebook ligado é o tipo de engano que só se
 * descobre na hora errada. Pacotes diferentes deixam os dois convivendo no
 * mesmo aparelho, com ícones e nomes distintos.
 *
 *     eas build --profile development --platform android   # o do Metro
 *     eas build --profile preview     --platform android   # o da portaria
 */
const SUFIXO_DEV = '.dev';

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') {
    return config;
  }

  return {
    ...config,
    name: `${config.name} (dev)`,
    // Esquema só com letras: o deep link do dev client não aceita hífen no
    // início do esquema, e manter tudo alfabético evita a discussão.
    scheme: `${config.scheme}dev`,
    android: {
      ...config.android,
      package: `${config.android.package}${SUFIXO_DEV}`,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}${SUFIXO_DEV}`,
    },
  };
};
