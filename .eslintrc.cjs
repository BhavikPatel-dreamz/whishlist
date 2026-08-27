/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  overrides: [
    {
      files: ["app/**/*.test.{ts,tsx}"],
      rules: {
        // Tests use vitest, not jest
        "jest/no-deprecated-functions": "off",
      },
    },
  ],
};
