import nextJest from "next/jest.js";

// next/jest cuida da transformação TypeScript via SWC e do alias `@/*`,
// a mesma configuração que os testes de componente vão usar na etapa 3.7.
const criarConfig = nextJest({ dir: "./" });

export default criarConfig({
  testEnvironment: "node",
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  /*
   * O banco de teste é criado e migrado uma vez; a URL é redirecionada antes de
   * qualquer import, porque `knexfile.ts` lê o ambiente no topo do módulo.
   */
  globalSetup: "<rootDir>/jest.globalSetup.ts",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.setupComponentes.ts"],
  collectCoverageFrom: ["dominio/**/*.ts", "!dominio/**/*.test.ts"],
});
