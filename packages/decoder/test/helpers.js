const debugModule = require("debug");
const debug = debugModule("decoder:test:helpers");

const WorkflowCompile = require("@truffle/workflow-compile");
const Migrate = require("@truffle/migrate");
const Codec = require("@truffle/codec");
const Config = require("@truffle/config");
const { Environment } = require("@truffle/environment");
const flatten = require("lodash.flatten");
const tmp = require("tmp");
tmp.setGracefulCleanup();

function unsafeNativizeDecoderVariables(variables) {
  return Object.assign(
    {},
    ...variables.map(({ name, value }) => ({
      [name]: Codec.Format.Utils.Inspect.unsafeNativize(value)
    }))
  );
  //note that the assignments are processed in order, so if multiple have same name, later
  //(i.e. more derived) will overwrite earlier (i.e. baser)... be aware!  I mean, this is the
  //right way to do overwriting, but it's still overwriting so still dangerous.
  //don't use this in real code!
}

async function prepareContracts(provider, projectDir) {
  const temporaryDirectory = tmp.dirSync({
    unsafeCleanup: true,
    prefix: "test-"
  }).name;

  let config = Config.detect({ working_directory: projectDir }).merge({
    contracts_build_directory: temporaryDirectory,
    networks: {
      decoder: {
        provider,
        network_id: "*"
      }
    },
    network: "decoder"
  });

  await Environment.detect(config);

  let { contractNames, compilations: rawCompilations } = await compile(config);

  await migrate(config);

  let abstractions = {};
  for (const name of contractNames) {
    abstractions[name] = config.resolver.require(name);
  }

  const compilations = Codec.Compilations.Utils.shimCompilations(
    rawCompilations
  );

  return {
    abstractions,
    compilations,
    config
  };
}

async function compile(config) {
  const { compilations } = await WorkflowCompile.compileAndSave(
    config.with({
      all: true,
      quiet: true
    })
  );
  const contractNames = flatten(
    compilations.map(compilation =>
      compilation.contracts.map(contract => contract.contractName)
    )
  );
  return { compilations, contractNames };
}

async function migrate(config) {
  return new Promise(function (accept, reject) {
    Migrate.run(
      config.with({
        quiet: true
      }),
      function (err, contracts) {
        if (err) return reject(err);
        accept(contracts);
      }
    );
  });
}

module.exports = {
  prepareContracts,
  unsafeNativizeDecoderVariables
};
