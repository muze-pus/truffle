const assert = require("chai").assert;
const fs = require("fs-extra");
const path = require("path");
const tmp = require("tmp");
const TruffleConfig = require("@truffle/config");
const { deriveConfigEnvironment } = require("../../lib/command-utils");

let config;

function createSandbox(source) {
  if (!fs.existsSync(source)) {
    throw new Error(`Sandbox failed: source: ${source} does not exist`);
  }

  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  fs.copySync(source, tempDir.name);
  const config = TruffleConfig.load(
    path.join(tempDir.name, "truffle-config.js"),
    {}
  );
  return config;
}

describe("command-utils", function () {
  before(function () {
    config = createSandbox(
      path.join(__dirname, "..", "sources", "command-utils")
    );
  });

  describe("deriveConfigEnvironment", function () {
    it("returns a config with specified network object having a provider property", function () {
      const expectedNetworkConfig = config.networks.crazyTimeNetwork;
      const cfg = deriveConfigEnvironment(
        config,
        "crazyTimeNetwork",
        undefined
      );
      assert.equal(
        cfg.networks.crazyTimeNetwork.confirmations,
        expectedNetworkConfig.confirmations
      );
      assert.equal(
        cfg.networks.crazyTimeNetwork.customUserProperty,
        expectedNetworkConfig.customUserProperty
      );
    });

    it("returns a config with a url host network object having the url property ", function () {
      const cfg = deriveConfigEnvironment(
        config,
        "anyTimeNetwork",
        "http://localhost:5555"
      );
      assert.equal(cfg.networks["anyTimeNetwork"].url, "http://localhost:5555");
    });

    it("returns a config with a network object having user specified properties", function () {
      const expectedNetworkConfig = config.networks.funTimeNetwork;
      const cfg = deriveConfigEnvironment(config, "funTimeNetwork", undefined);
      assert.equal(
        cfg.networks.funTimeNetwork.host,
        expectedNetworkConfig.host
      );
      assert.equal(
        cfg.networks.funTimeNetwork.port,
        expectedNetworkConfig.port
      );
      assert.equal(
        cfg.networks.funTimeNetwork.confirmations,
        expectedNetworkConfig.confirmations
      );
      assert.equal(
        cfg.networks.funTimeNetwork.customUserProperty,
        expectedNetworkConfig.customUserProperty
      );
    });

    it("returns a config with a dashboard network object having user specified properties", function () {
      const expectedNetworkConfig = config.networks.dashboard;
      const cfg = deriveConfigEnvironment(config, "dashboard", undefined);
      assert.equal(cfg.networks.dashboard.url, expectedNetworkConfig.url);
      assert.equal(
        cfg.networks.dashboard.confirmations,
        expectedNetworkConfig.confirmations
      );
      assert.equal(
        cfg.networks.dashboard.customUserProperty,
        expectedNetworkConfig.customUserProperty
      );
    });
  });
});
