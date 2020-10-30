require("source-map-support/register");
const pkg = require("./package.json");

module.exports = {
  build: require("./lib/build"),
  create: require("./lib/commands/create/helpers"),
  console: require("./lib/repl"),
  // TODO: update this to non-legacy the next breaking change
  contracts: require("@truffle/workflow-compile/legacy"),
  test: require("./lib/testing/Test"),
  package: require("@truffle/ethpm-v3"),
  version: pkg.version,
  ganache: require("ganache-core/public-exports")
};
