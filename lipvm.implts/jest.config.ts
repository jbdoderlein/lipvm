/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: 'ts-jest',
  testEnvironment: "jsdom",
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  globals: {
    "ts-test": {
      tsConfig: "tsconfig.test.json",
    },
  },
};