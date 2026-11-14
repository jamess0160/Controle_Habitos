import webpush from "web-push";

/**
 * Gera um par de chaves VAPID e imprime as linhas do `.env`.
 *
 * **Imprime, não grava.** O par é a identidade do remetente perante o serviço de
 * push: o navegador assina *para* uma chave pública específica, e um envio
 * assinado por outra é recusado — gerar por cima do que está em uso invalidaria
 * toda assinatura existente, em silêncio do ponto de vista de quem usa o app.
 * Colar à mão é a confirmação que falta num comando que, sozinho, não teria como
 * perguntar "tem certeza?".
 *
 * Depois de colar no `.env`, `npm run db:seed` leva o par para `config_app`, que
 * é de onde o envio lê. O seed usa `ON CONFLICT DO NOTHING`, então trocar o par
 * de verdade exige apagar as duas linhas da tabela antes.
 */
const par = webpush.generateVAPIDKeys();

console.log(`
Par VAPID gerado. Cole no .env:

VAPID_PUBLIC_KEY=${par.publicKey}
VAPID_PRIVATE_KEY=${par.privateKey}

Depois: npm run db:seed

A chave privada é segredo — ela assina os envios. A pública não é: ela viaja
para o serviço de push em toda assinatura, e é o que o navegador recebe em
GET /api/config.

Se já havia um par em uso, as assinaturas feitas com o anterior param de
funcionar e o aparelho precisa assinar de novo em Ajustes.
`);
