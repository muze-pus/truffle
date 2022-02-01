const debug = require("debug")("migrate:Migration");
const path = require("path");
const Deployer = require("@truffle/deployer");
const Require = require("@truffle/require");
const {
  Web3Shim,
  createInterfaceAdapter
} = require("@truffle/interface-adapter");
const ResolverIntercept = require("./ResolverIntercept");
const { getTruffleDb } = require("@truffle/db-loader");
const emitEvent = require("./emitEvent");

class Migration {
  constructor(file, config) {
    this.file = path.resolve(file);
    this.number = parseInt(path.basename(file));
    this.isFirst = false;
    this.isLast = false;
    this.dryRun = config.dryRun;
    this.interactive = config.interactive;
    this.config = config || {};
  }

  // ------------------------------------- Private -------------------------------------------------
  /**
   * Loads & validates migration, then runs it.
   * @param  {Object}   options  config and command-line
   * @param  {Object}   context  web3 & interfaceAdapter
   * @param  {Object}   deployer truffle module
   * @param  {Object}   resolver truffle module
   */
  async _load(options, context, deployer, resolver) {
    // Load assets and run `execute`
    const accounts = await context.interfaceAdapter.getAccounts();
    const requireOptions = {
      file: this.file,
      context: context,
      resolver: resolver,
      args: [deployer]
    };

    const fn = Require.file(requireOptions);

    const unRunnable = !fn || !fn.length || fn.length == 0;

    if (unRunnable) {
      const msg = `Migration ${this.file} invalid or does not take any parameters`;
      throw new Error(msg);
    }

    // `migrateFn` might be sync or async. We negotiate that difference in
    // `execute` through the deployer API.
    const migrateFn = fn(deployer, options.network, accounts);
    await this._deploy(options, context, deployer, resolver, migrateFn);
  }

  /**
   * Initiates deployer sequence, then manages migrations info
   * publication to chain / artifact saving.
   * @param  {Object}   options     config and command-line
   * @param  {Object}   context     web3 & interfaceAdapter
   * @param  {Object}   deployer    truffle module
   * @param  {Object}   resolver    truffle module
   * @param  {[type]}   migrateFn   module.exports of a migrations.js
   */
  async _deploy(options, context, deployer, resolver, migrateFn) {
    try {
      await deployer.start();
      // Allow migrations method to be async and
      // deploy to use await
      if (migrateFn && migrateFn.then !== undefined) {
        await deployer.then(() => migrateFn);
      }

      // Migrate without saving
      if (options.save === false) return;

      let Migrations;
      // Attempt to write migrations record to chain
      try {
        Migrations = resolver.require("Migrations");
      } catch (error) {
        // do nothing, Migrations contract optional
      }

      if (Migrations && Migrations.isDeployed()) {
        const message = `Saving migration to chain.`;
        if (!this.dryRun) {
          const data = { message: message };
          await emitEvent(
            options,
            "migrate:settingCompletedMigrations:start",
            data
          );
        }

        const migrations = await Migrations.deployed();
        const receipt = await migrations.setCompleted(this.number);

        if (!this.dryRun) {
          const data = { receipt: receipt, message: message };
          await emitEvent(
            options,
            "migrate:settingCompletedMigrations:succeed",
            data
          );
        }
      }

      const eventArgs = {
        isLast: this.isLast,
        interfaceAdapter: context.interfaceAdapter
      };

      await emitEvent(options, "migrate:migration:succeed", eventArgs);

      let artifacts = resolver
        .contracts()
        .map(abstraction => abstraction._json);
      if (this.config.db && this.config.db.enabled && artifacts.length > 0) {
        // currently if Truffle Db fails to load, getTruffleDb returns `null`
        const Db = getTruffleDb();

        if (Db) {
          const db = Db.connect(this.config.db);
          const project = await Db.Project.initialize({
            db,
            project: {
              directory: this.config.working_directory
            }
          });

          const result = await project
            .connect({ provider: this.config.provider })
            .loadMigrate({
              network: {
                name: this.config.network
              },
              artifacts
            });

          ({ artifacts } = result);

          await project.assignNames({
            assignments: {
              networks: [result.network]
            }
          });
        }
      }

      // Save artifacts to local filesystem
      await options.artifactor.saveAll(artifacts);

      deployer.finish();

      // Cleanup
      if (this.isLast) {
        // Exiting w provider-engine appears to be hopeless. This hack on
        // our fork just swallows errors from eth-block-tracking
        // as we unwind the handlers downstream from here.
        if (this.config.provider && this.config.provider.engine) {
          this.config.provider.engine.silent = true;
        }
      }
    } catch (error) {
      const errorData = {
        type: "migrateErr",
        error: error
      };

      await emitEvent(options, "migrate:migration:error", errorData);
      deployer.finish();
      throw error;
    }
  }

  // ------------------------------------- Public -------------------------------------------------
  /**
   * Instantiates a deployer, connects this migration and its deployer to the reporter
   * and launches a migration file's deployment sequence
   * @param  {Object}   options  config and command-line
   */
  async run(options) {
    const { interfaceAdapter, resolver, context, deployer } =
      this.prepareForMigrations(options);

    // Get file path and emit pre-migration event
    const file = path.relative(options.migrations_directory, this.file);
    const block = await interfaceAdapter.getBlock("latest");

    const preMigrationsData = {
      file: file,
      number: this.number,
      isFirst: this.isFirst,
      network: options.network,
      networkId: options.network_id,
      blockLimit: block.gasLimit
    };

    await emitEvent(options, "migrate:migration:start", preMigrationsData);
    await this._load(options, context, deployer, resolver);
  }

  prepareForMigrations(options) {
    const interfaceAdapter = createInterfaceAdapter({
      provider: options.provider,
      networkType: options.networks[options.network].type
    });
    const web3 = new Web3Shim({
      provider: options.provider,
      networkType: options.networks[options.network].type
    });

    const resolver = new ResolverIntercept(options.resolver);

    // Initial context.
    const context = { web3, interfaceAdapter, config: this.config };

    const deployer = new Deployer(options);

    return { interfaceAdapter, resolver, context, deployer };
  }

  /**
   * Returns a serializable version of `this`
   * @returns  {Object}
   */
  serializeable() {
    return {
      file: this.file,
      number: this.number,
      isFirst: this.isFirst,
      isLast: this.isLast,
      dryRun: this.dryRun,
      interactive: this.interactive
    };
  }
}

module.exports = Migration;
