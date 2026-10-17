# Validação da Sofa no Windows

Execute esta matriz em um ROG Ally com Windows atualizado, usando a build produzida pelo fluxo de release. Registre versão do Windows, modelo, versão da Sofa, resultado e trecho relevante de `sofa.log` para cada falha. Faça os fluxos principais sem mouse nem teclado; o toque é uma verificação adicional.

| Fluxo | Passos com controle | Resultado esperado |
| --- | --- | --- |
| Primeira abertura | Instalar, abrir a Sofa e percorrer Home, Biblioteca, Loja e Configurações | Foco visível, nenhuma ação inacessível e textos legíveis em 1280×720 |
| Entrada nas lojas | Com biblioteca vazia, conectar Steam e Epic, concluir autenticação e voltar à Sofa | Login concluído sem teclado físico; cancelamento devolve o foco ao controle anterior |
| Biblioteca | Abrir jogos Steam, Epic e GOG instalados; adicionar um programa em Configurações → Apps, abri-lo pela Biblioteca e removê-lo; pesquisar, filtrar, favoritar e voltar | Jogo ou programa correto abre, a Sofa retoma o foco ao fechar o jogo e o programa removido deixa a Biblioteca |
| Xbox/Microsoft Store | Instalar dois jogos GDK pelo Xbox app, abrir a Biblioteca e iniciar cada um pela Sofa; comparar com um aplicativo comum da Store | Os jogos aparecem uma vez, abrem com a identidade Xbox e o aplicativo comum não aparece como jogo |
| GOG | Com Galaxy conectado, conferir jogo comprado e não instalado; abrir a instalação e concluir | Jogo aparece como não instalado, a página correta abre no Galaxy e o jogo instalado substitui a entrada sem duplicata; sem Galaxy a biblioteca local segue funcional |
| Instalação | Iniciar instalação Steam, Epic e GOG, reiniciar a Sofa durante o download, interromper o acompanhamento pelo controle e concluir | Estado pendente reaparece após reinício, o botão de parar acompanhamento funciona e o jogo instalado entra na biblioteca |
| Lançamentos | Abrir Loja → Lançamentos, navegar e abrir um título | Só jogos Windows aparecem; a página correta da Steam abre e erro de rede é recuperável |
| Perfis por jogo | Salvar brilho, resolução e perfil de energia; anotar os valores anteriores, abrir e fechar um jogo, tentar abrir um jogo que falha e reiniciar a Sofa durante uma sessão | Ajustes são aplicados no jogo, valores anteriores retornam depois do encerramento e o registro pendente sobrevive ao reinício |
| HUD/Game Bar | Abrir com o botão Xbox de um controle Xbox e de um controle XInput de terceiros (sem abrir e fechar em seguida), navegar em modo compacto, fechar com B e repetir com controle externo | Ações críticas acessíveis, foco preservado e HUD atualizado sobre jogo em janela sem borda |
| Suspensão | Suspender durante Home e durante um jogo; retomar, abrir HUD e navegar | Controle e foco voltam a responder; dados são atualizados sem reiniciar a Sofa |
| Xbox FSE | Escolher Sofa como home app, reiniciar o aparelho e entrar/sair do modo | Sofa abre em tela cheia, recebe o controle e permanece acessível após encerrar o jogo |
| Offline | Desconectar a rede, abrir biblioteca e HUD e tentar consultar Loja | Jogos locais e HUD funcionam; Loja mostra erro traduzido e recupera ao reconectar |
| Atualização OTA | Instalar versão anterior, oferecer versão superior assinada e aplicar pela UI | Reinício na versão nova, preferências preservadas e nenhum relançamento da mesma versão |
| Desinstalação | Desinstalar a Sofa após os testes | Widget, pacote de identidade e certificado removidos; escolha de home app preservada se pertencer a outro app |

Repita HUD e retorno ao jogo em DirectX, Vulkan e OpenGL quando houver jogos disponíveis. A documentação da Microsoft registra limitações da Game Bar em alguns modos de tela cheia Vulkan/OpenGL; registre isso como limitação da plataforma, não como sucesso do HUD.

Esta matriz ainda não foi executada em um ROG Ally. A compilação cruzada do Rust e a prévia em 1280×720 verificam código e layout, mas não comprovam foco do WebView2 no widget, autenticação com controle, instalação de pacotes Xbox nem o retorno dos ajustes de energia após encerrar um jogo. Esses fluxos só mudam para **validado** com resultados registrados no dispositivo.

Fontes: [orientação da Microsoft para launchers em handhelds](https://learn.microsoft.com/en-us/xbox/gdk/docs/gdk-dev/pc-dev/handheld/handheld-launchers), [problemas conhecidos da Xbox Game Bar](https://learn.microsoft.com/en-us/xbox/game-bar/known-issues) e implementação atual em `src-tauri/src/`, `src/` e `widget/`.
