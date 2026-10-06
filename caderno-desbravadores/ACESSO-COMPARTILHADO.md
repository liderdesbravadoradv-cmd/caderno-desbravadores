# Caderno compartilhado pelo computador

## Como os dados ficam guardados

O modo compartilhado roda neste computador. A base SQLite e os anexos ficam em `caderno-desbravadores/local-data/`; não são enviados ao GitHub nem ao Cloudflare. Deixe o computador ligado e conectado à internet para que os outros dispositivos acessem os mesmos dados. Fechar o Quick Tunnel encerra o acesso externo, mas conserva a base no disco.

O endereço do Cloudflare Quick Tunnel é temporário e muda quando o túnel é iniciado novamente. As pessoas autorizadas recebem um PIN por e-mail antes de abrir o site e depois entram no Caderno com seus usuários e senhas próprios.

## Primeira configuração

1. Instale Node.js 24 ou mais recente e o `cloudflared` oficial: <https://developers.cloudflare.com/tunnel/downloads/>.
2. Crie `allowed-emails.txt` nesta pasta, com um e-mail por linha. Inclua somente você e os amigos autorizados. Esse arquivo está fora do Git.
3. Inicie `Start-SharedCaderno.ps1`. A janela exibirá o endereço temporário `trycloudflare.com`.
4. Entre como Diretor e altere a senha em **Meu acesso** antes de compartilhar o endereço.
5. No site antigo, entre como Diretor e use **Baixar cópia desta base**. O arquivo JSON contém a base, hashes de senha e anexos; guarde-o com cuidado.
6. Abra o endereço do Quick Tunnel, entre como Diretor e selecione **Importar cópia antiga**. A base antiga no navegador não será apagada. A importação só fica disponível enquanto o servidor ainda está vazio.
7. Compartilhe o endereço somente com os e-mails colocados em `allowed-emails.txt`. Cada pessoa recebe o PIN no próprio e-mail e entra com a conta do Caderno que você cadastrou.

## Uso diário

Inicie `Start-SharedCaderno.ps1` para abrir o acesso. Mantenha a janela aberta enquanto as pessoas usam o Caderno. Pressione Ctrl+C para fechar o túnel e encerrar o servidor; os dados continuam em `local-data/`.

Faça cópias de segurança periódicas da pasta `local-data/` para um local seguro. Ela contém a base e todos os arquivos enviados. Não a envie ao GitHub.

O Quick Tunnel é um recurso gratuito de teste, sem garantia de disponibilidade. O endereço é aleatório e muda a cada início. O filtro de e-mail restringe quem consegue abrir o link.
