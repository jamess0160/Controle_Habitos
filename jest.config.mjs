import nextJest from "next/jest.js";

// next/jest cuida da transformação TypeScript via SWC e do alias `@/*`,
// a mesma configuração que os testes de componente vão usar na etapa 3.7.
const criarConfig = nextJest({ dir: "./" });

export default criarConfig({
  testEnvironment: "node",
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  collectCoverageFrom: ["dominio/**/*.ts", "!dominio/**/*.test.ts"],
});
