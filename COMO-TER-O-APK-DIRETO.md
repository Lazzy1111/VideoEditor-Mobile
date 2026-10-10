# VideoEditor Mobile — APK direto para instalar no Android

## Resultado desejado

Depois de **compilar** e publicar o pacote, o usuário abre um link que termina em `.apk`, baixa o aplicativo no Android e toca no arquivo para instalar. **Não é necessário extrair ZIP no celular.** A primeira instalação fora da Play Store pode exigir a autorização “Instalar apps desconhecidos” para o navegador ou gerenciador de arquivos.

**Este pacote é CÓDIGO-FONTE ANDROID, ainda não o APK.** A compilação não foi possível neste ambiente por falta do Android SDK/Gradle e de acesso a seus downloads. Não foi testado em aparelho real.

## Opção A — Android Studio no computador

1. Instale Android Studio e o SDK Android 35.
2. Abra esta pasta inteira, que contém `settings.gradle`, como projeto Android.
3. Aguarde a sincronização Gradle (precisa de internet no seu computador).
4. Menu Build > Build Bundle(s) / APK(s) > Build APK(s).
5. Localize `app/build/outputs/apk/debug/app-debug.apk`.
6. Renomeie o arquivo para `VideoEditor-Mobile-0.2-BETA.apk` se desejar. **Não altere a extensão nem transforme o APK em ZIP.**
7. Envie o `.apk` por cabo, nuvem ou outro meio para o celular Android e abra o arquivo para instalar.

## Opção B — Link direto via GitHub Releases, sem ZIP no celular

1. No computador, crie um repositório no GitHub (se quiser preservar o código, use repositório privado; o link exigirá login).
2. Envie **o conteúdo desta pasta como raiz do repositório**, incluindo `.github/workflows/android-apk.yml`, `app/`, `build.gradle`, `settings.gradle` e `gradle.properties`.
3. No GitHub, abra **Actions > Gerar APK direto para Android > Run workflow**.
4. O workflow tentará compilar e validar o APK, incluindo uma verificação de assinatura; se houver algum erro, consulte os logs e **não publique como se funcionasse**.
5. Com a execução concluída com sucesso, abra **Releases** do repositório.
6. Entre na release `VideoEditor Mobile 0.2 BETA — Android`. Em **Assets**, clique em `VideoEditor-Mobile-0.2-BETA.apk`. Esse é o download direto **sem ZIP**.
7. No celular Android, abra o APK baixado e autorize a instalação caso seja solicitado.

O GitHub pode bloquear a criação de releases para workflows sem permissão de escrita. Se necessário, configure no repositório **Settings > Actions > General > Workflow permissions > Read and write permissions**, caso a política do repositório permita.

## Atenções importantes

- Este APK é uma **versão debug** para teste, não distribuição profissional pela Play Store.
- Versões debug recompiladas no GitHub podem receber **assinaturas diferentes**; instalar como atualização pode falhar. Para atualizar preservando dados, é necessário manter a **mesma chave de assinatura** em todas as versões.
- A instalação do APK não garante que todas as funções de edição ou a exportação de vídeo funcionem no WebView do seu telefone. Teste com mídias reais.
- Android mínimo configurado: **Android 10 (API 29)**.
- Se o seu celular for **iPhone**, um `.apk` não funcionará: a distribuição exige um app iOS próprio e método de instalação compatível, ou uma PWA publicada em HTTPS.
- A publicação por lojas exige processo de distribuição, conta de desenvolvedor, assinatura apropriada, revisão e políticas de privacidade; este pacote não equivale a uma publicação na loja.
