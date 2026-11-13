import { emDesenvolvimento, modoDoApp } from "./modo";

/**
 * O que estes testes protegem é uma direção, não um valor: qualquer dúvida sobre
 * `APP_MODO` tem de resultar em **produção**.
 *
 * O risco real é um `.env` de produção sem a variável, ou com ela escrita
 * errado, deixando a senha ativa para sempre num app exposto na internet — que é
 * exatamente o que o cadastro da biometria existe para impedir. Por isso a
 * tabela abaixo é majoritariamente de valores inválidos.
 */

const original = process.env.APP_MODO;

afterEach(() => {
  if (original === undefined) delete process.env.APP_MODO;
  else process.env.APP_MODO = original;
});

describe("APP_MODO falha fechada", () => {
  const produz_producao = [
    undefined,
    "",
    "   ",
    "producao",
    "production",
    "dev",
    "development",
    "desenvolvimeto",
    "desenvolvimento-x",
    "true",
    "1",
  ];

  it.each(produz_producao)("%p é produção", (valor) => {
    if (valor === undefined) delete process.env.APP_MODO;
    else process.env.APP_MODO = valor;

    expect(modoDoApp()).toBe("producao");
    expect(emDesenvolvimento()).toBe(false);
  });
});

describe("a palavra exata liga o modo de desenvolvimento", () => {
  it.each(["desenvolvimento", "DESENVOLVIMENTO", " desenvolvimento ", "Desenvolvimento"])(
    "%p é desenvolvimento",
    (valor) => {
      process.env.APP_MODO = valor;

      expect(modoDoApp()).toBe("desenvolvimento");
      expect(emDesenvolvimento()).toBe(true);
    },
  );
});
