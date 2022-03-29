module.exports = async function (options) {
  const WorkflowCompile = require("@truffle/workflow-compile");
  const { Environment } = require("@truffle/environment");
  const Config = require("@truffle/config");
  const determineDryRunSettings = require("./determineDryRunSettings");
  const prepareConfigForRealMigrations = require("./prepareConfigForRealMigrations");
  const runMigrations = require("./runMigrations");
  const setUpDryRunEnvironmentThenRunMigrations = require("./setUpDryRunEnvironmentThenRunMigrations");
  const tmp = require("tmp");
  tmp.setGracefulCleanup();

  const config = Config.detect(options);
  if (config.compileNone || config["compile-none"]) {
    config.compiler = "none";
  }

  const result = await WorkflowCompile.compileAndSave(config);
  await WorkflowCompile.assignNames(config, result);
  await Environment.detect(config);

  const { dryRunOnly, dryRunAndMigrations } = determineDryRunSettings(
    config,
    options
  );

  if (dryRunOnly) {
    config.dryRun = true;
    await setUpDryRunEnvironmentThenRunMigrations(config);
  } else if (dryRunAndMigrations) {
    const currentBuild = config.contracts_build_directory;
    config.dryRun = true;

    await setUpDryRunEnvironmentThenRunMigrations(config);

    const { preparedConfig, proceed } = await prepareConfigForRealMigrations(
      currentBuild,
      options
    );
    if (proceed) await runMigrations(preparedConfig);
  } else {
    await runMigrations(config);
  }
};
