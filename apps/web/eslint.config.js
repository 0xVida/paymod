import nextConfig from "eslint-config-next";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";

const config = [
  { ignores: [".next", "out"] },
  ...nextConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
];

export default config;
