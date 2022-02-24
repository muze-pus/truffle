const parseCommandLineFlags = options => {
  // parse out command line flags to merge in to the config
  const grep = options.grep || options.g;
  const bail = options.bail || options.b;
  const reporter = options.reporter || options.r;

  /**
   * This if-else condition is explicitly written to avoid the overlapping of
   * the config by the default mocha reporter type when user specifies a mocha reporter type
   * in the config and doesn't specify it as the command line argument.
   * If the reporter is returned as undefined, it ignores the specification of any reporter type in the
   * config and displays the default mocha reporter "spec", as opposed to reporter completely being absent
   * which results in checking for the reporter type specified in the config.
   */
  if (reporter === undefined) {
    return {
      mocha: {
        grep,
        bail
      }
    };
  } else {
    return {
      mocha: {
        grep,
        bail,
        reporter
      }
    };
  }
};

module.exports = async function (options) {
  const Config = require("@truffle/config");
  const { Environment, Develop } = require("@truffle/environment");
  const { copyArtifactsToTempDir } = require("./copyArtifactsToTempDir");
  const { determineTestFilesToRun } = require("./determineTestFilesToRun");
  const { prepareConfigAndRunTests } = require("./prepareConfigAndRunTests");

  const optionsToMerge = parseCommandLineFlags(options);
  const config = Config.detect(options).merge(optionsToMerge);

  // if "development" exists, default to using that for testing
  if (!config.network && config.networks.development) {
    config.network = "development";
  }

  if (!config.network) {
    config.network = "test";
  } else {
    await Environment.detect(config);
  }

  if (config.stacktraceExtra) {
    config.stacktrace = true;
    config.compileAllDebug = true;
  }
  // enables in-test debug() interrupt, or stacktraces, forcing compileAll
  if (config.debug || config.stacktrace || config.compileAllDebug) {
    config.compileAll = true;
  }

  const { file } = options;
  const inputArgs = options._;
  const files = determineTestFilesToRun({
    config,
    inputArgs,
    inputFile: file
  });

  /**
   * If test network exists and provider, host or url doesn't exist, then internal ganache is started with the user specified
   * configurations in the config.
   * If development or test network with provider, host or url exists, then it connects to that network specified in the config.
   * If no network is specified in the config, then internal ganache is started with default configuration.
   */
  const configuredNetwork = config.networks[config.network];
  const testNetworkDefined = configuredNetwork && config.network == "test";
  const noProviderHostOrUrlConfigured =
    configuredNetwork &&
    !configuredNetwork.provider &&
    !configuredNetwork.host &&
    !configuredNetwork.url;
  const port = await require("get-port")();
  const ipcOptions = { network: "test" };

  if (testNetworkDefined && noProviderHostOrUrlConfigured) {
    const ganacheOptions = {
      host: "127.0.0.1",
      port,
      network_id: 4447,
      mnemonic:
        "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
      time: config.genesis_time,
      miner: {
        instamine: "strict"
      },
      ...config.networks[config.network]
    };
    const numberOfFailures = await startGanacheAndRunTests(
      ipcOptions,
      ganacheOptions,
      config
    );
    return numberOfFailures;
  } else if (configuredNetwork) {
    await Environment.detect(config);
    const { temporaryDirectory } = await copyArtifactsToTempDir(config);
    const numberOfFailures = await prepareConfigAndRunTests({
      config,
      files,
      temporaryDirectory
    });
    return numberOfFailures;
  } else {
    const ganacheOptions = {
      host: "127.0.0.1",
      port,
      network_id: 4447,
      mnemonic:
        "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
      time: config.genesis_time,
      miner: {
        instamine: "strict"
      }
    };
    const numberOfFailures = await startGanacheAndRunTests(
      ipcOptions,
      ganacheOptions,
      config
    );
    return numberOfFailures;
  }

  // Start internal ganache network
  async function startGanacheAndRunTests(ipcOptions, ganacheOptions, config) {
    const { disconnect } = await Develop.connectOrStart(
      ipcOptions,
      ganacheOptions
    );
    const ipcDisconnect = disconnect;
    await Environment.develop(config, ganacheOptions);
    const { temporaryDirectory } = await copyArtifactsToTempDir(config);
    const numberOfFailures = await prepareConfigAndRunTests({
      config,
      files,
      temporaryDirectory
    });
    ipcDisconnect();
    return numberOfFailures;
  }
};
