# tablet/ — reservado

O app do totem ainda vive em
[Bunnyzzx/Detecao-de-EPI-Fetin](https://github.com/Bunnyzzx/Detecao-de-EPI-Fetin),
branch `mobile-rn`.

Quando ele estabilizar, traga para cá **preservando o histórico**:

```bash
git subtree add --prefix=tablet \
  https://github.com/Bunnyzzx/Detecao-de-EPI-Fetin.git mobile-rn
```

Não copie os arquivos à mão: isso descarta a autoria e o histórico de quem
escreveu o app.

Este arquivo existe porque o Git não versiona pasta vazia — apague-o quando
o `git subtree` trouxer o app.
