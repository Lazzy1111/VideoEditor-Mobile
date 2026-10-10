# Gerar o APK Android de desenvolvimento

Este diretório é um projeto de **Android Studio**. **Não contém APK previamente compilado**.

1. Instale o Android Studio e os SDKs Android 35.
2. Abra a pasta `android/` no Android Studio (Open).
3. Configure o **Gradle 8.10.2** nas opções da IDE caso seja solicitado. Este projeto não contém o JAR do Gradle Wrapper; é necessário usar uma instalação do Gradle ou o fluxo pronto do GitHub Actions. A sincronização baixa dependências e requer internet.
4. No menu **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. O arquivo sairá em `app/build/outputs/apk/debug/app-debug.apk`.
6. Transfira o APK ao Android e instale, quando permitido pelas configurações de segurança do aparelho.

Alternativa: coloque **o conteúdo desta pasta `android/`** em um repositório GitHub. Vá em **Actions > Build Android debug APK > Run workflow**, espere a compilação, baixe o artefato gerado e extraia o APK.

**Atenção:** o APK resultante é **debug** e requer validação em dispositivo físico. O contêiner usa Android WebView e as ferramentas de codec são as do WebView do aparelho, não uma engine nativa Media3. Não assuma que todos os telefones suportam exportação MP4.
