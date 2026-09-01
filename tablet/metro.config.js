// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `.onnx` não faz parte dos `assetExts` padrão do Metro. Sem isto o
 * empacotador tentaria interpretar o modelo como JavaScript e o `require` do
 * arquivo falharia — ele precisa ser tratado como asset binário para ser
 * incluído no APK e resolvido pelo expo-asset em tempo de execução.
 */
config.resolver.assetExts.push('onnx');

module.exports = config;
