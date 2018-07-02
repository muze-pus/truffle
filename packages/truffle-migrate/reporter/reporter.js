const util = require('util');
const web3Utils = require('web3-utils');
const readline = require('readline');
const ora = require('ora');

const indentedSpinner = require('./indentedSpinner');
const MigrationsMessages = require('./messages');

/**
 *  Reporter consumed by a migrations sequence which iteself consumes a series of Migration and
 *  Deployer instances that emit both async `Emittery` events and conventional EventEmitter
 *  events (from Web3PromiEvent). This reporter is designed to track the execution of
 *  several migrations files in sequence and is analagous to the Mocha reporter in that:
 *
 *  test:: deployment
 *  suite:: deployer.start to deployer.finish
 *  test file:: migrations file
 *
 *  Each time a new migrations file loads, the reporter needs the following properties
 *  updated to reflect the current emitter source:
 *  + `this.migration`
 *  + `this.deployer`
 */
class Reporter {

  constructor(){
    this.deployingMany = false;
    this.deployer = null;
    this.migration = null;
    this.currentGasTotal = 0;
    this.currentCostTotal = new web3Utils.BN(0);
    this.finalCostTotal = new web3Utils.BN(0);
    this.deployments = 0;
    this.separator = '\n';
    this.summary = [];
    this.currentFileIndex = -1;
    this.blockSpinner = null;
    this.currentBlockWait = '';

    this.messages = new MigrationsMessages(this);
  }

  // ------------------------------------  Utilities -----------------------------------------------

  /**
   * Sets a Migration instance to be the current migrations events emitter source
   * @param {Migration} migration
   */
  setMigration(migration){
    this.migration = migration;
  }

  /**
   * Sets a Deployer instance as the current deployer events emitter source
   * @param {Deployer} deployer
   */
  setDeployer(deployer){
    this.deployer = deployer
  }

  /**
   * Registers emitter handlers
   */
  listen(){

    // Migration
    this.migration.emitter.on('preMigrate',          this.preMigrate.bind(this));
    this.migration.emitter.on('saveMigration',       this.saveMigrate.bind(this));
    this.migration.emitter.on('postMigrate',         this.postMigrate.bind(this));
    this.migration.emitter.on('error',               this.error.bind(this));

    // Deployment
    this.deployer.emitter.on('preDeploy',            this.preDeploy.bind(this));
    this.deployer.emitter.on('postDeploy',           this.postDeploy.bind(this));
    this.deployer.emitter.on('preDeployMany',        this.preDeployMany.bind(this));
    this.deployer.emitter.on('postDeployMany',       this.postDeployMany.bind(this));
    this.deployer.emitter.on('deployFailed',         this.deployFailed.bind(this));
    this.deployer.emitter.on('linking',              this.linking.bind(this));
    this.deployer.emitter.on('error',                this.error.bind(this));
    this.deployer.emitter.on('transactionHash',      this.hash.bind(this));
    this.deployer.emitter.on('confirmation',         this.confirmation.bind(this));
    this.deployer.emitter.on('block',                this.block.bind(this));
  }

  /**
   * Retrieves gas usage totals per migrations file / totals since the reporter
   * started running. Calling this method resets the gas counters for migrations totals
   */
  getTotals(){
    const gas = this.currentGasTotal;
    const cost = web3Utils.fromWei(this.currentCostTotal, "ether");
    this.finalCostTotal = this.finalCostTotal.add(this.currentCostTotal);

    this.currentGasTotal = 0;
    this.currentCostTotal = new web3Utils.BN(0);

    return {
      gas: gas,
      cost: cost,
      finalCost: web3Utils.fromWei(this.finalCostTotal, "ether"),
      deployments: this.deployments.toString()
    }
  }

  /**
   * Queries the user for a true/false response and resolves the result.
   * @param  {String} type identifier the reporter consumes to format query
   * @return {Promise}
   */
  askBoolean(type){
    const self = this;
    const question = this.messages.questions(type);
    const exitLine = this.messages.exitLines(type);

    // NB: We need direct access to a writeable stream here.
    // This ignores `quiet` - but we only use that mode for `truffle test`.
    const input = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const affirmations = ['y', 'yes', 'YES', 'Yes'];

    return new Promise(resolve => {

      input.question(question, (answer) => {
        if (affirmations.includes(answer.trim())){
          input.close();
          return resolve(true);
        };

        input.close();
        self.migration.logger.log(exitLine);
        resolve(false);
      })
    });
  }

  /**
   * Error dispatcher. Parses the error returned from web3 and outputs a more verbose error after
   * doing what it can to evaluate the failure context from data passed to it.
   * @param  {Object} data info collected during deployment attempt
   */
  async processDeploymentError(data){
    let message;
    const error = data.estimateError || data.error;

    data.reason = (data.error) ? data.error.reason : null;

    const errors = {
      OOG: error.message.includes('out of gas') || (data.gas === data.blockLimit),
      INT: error.message.includes('base fee') || error.message.includes('intrinsic'),
      RVT: error.message.includes('revert'),
      ETH: error.message.includes('funds'),
      BLK: error.message.includes('block gas limit'),
      NCE: error.message.includes('nonce'),
      INV: error.message.includes('invalid opcode'),
      GTH: error.message.includes('always failing transaction')
    }

    let type = Object.keys(errors).find(key => errors[key]);

    switch (type) {
      // `Intrinsic gas too low`
      case 'INT':
        (data.gas)
          ? message = this.messages.errors('intWithGas', data)
          : message = this.messages.errors('intNoGas', data);

        this.deployer.logger.error(message);
        break;

      // `Out of gas`
      case 'OOG':
        (data.gas && !(data.gas === data.blockLimit))
          ? message = this.messages.errors('intWithGas', data)
          : message = this.messages.errors('oogNoGas', data);

        this.deployer.logger.error(message);
        break;

      // `Revert`
      case 'RVT':
        (data.reason)
          ? message = this.messages.errors('rvtReason', data)
          : message = this.messages.errors('rvtNoReason', data);

        this.deployer.logger.error(message);
        break;

      // `Invalid opcode`
      case 'INV':
        (data.reason)
          ? message = this.messages.errors('asrtReason', data)
          : message = this.messages.errors('asrtNoReason', data);

        this.deployer.logger.error(message);
        break;

      // `Exceeds block limit`
      case 'BLK':
        (data.gas)
          ? message = this.messages.errors('blockWithGas', data)
          : message = this.messages.errors('blockNoGas', data)

        this.deployer.logger.error(message);
        break;

      // `Insufficient funds`
      case 'ETH':
        const balance = await data.contract.web3.eth.getBalance(data.from);
        data.balance = balance.toString();
        message = this.messages.errors('noMoney', data);
        this.deployer.logger.error(message);
        break;

      // `Invalid nonce`
      case 'NCE':
        message = this.messages.errors('nonce', data);
        this.deployer.logger.error(message);
        break;

      // Generic geth error
      case 'GTH':
        message = this.messages.errors('geth', data);
        this.deployer.logger.error(message);
        break;

      default:
        message = this.messages.errors('default', data);
        this.deployer.logger.error(message);
    }
  }

  // ---------------------------- Interaction Handlers ---------------------------------------------

  async acceptDryRun(){
    return this.askBoolean('acceptDryRun');
  }

  // -------------------------  Migration File Handlers --------------------------------------------

  /**
   * Run when a migrations file is loaded, before deployments begin
   * @param  {Object} data
   */
  async preMigrate(data){
    let message;
    if (data.isFirst){
      message = this.messages.steps('firstMigrate', data);
      this.deployer.logger.log(message);
    }

    this.summary.push({
      file: data.file,
      deployments: [],
    });

    this.currentFileIndex++;

    message = this.messages.steps('preMigrate', data);
    this.deployer.logger.log(message);
  }

  /**
   * Run when a migrations file deployment sequence has completed,
   * before the migrations is saved to chain via Migrations.sol
   * @param  {Object} data
   */
  async saveMigrate(data){
    if (this.migration.dryRun) return;

    const message = this.messages.steps('saving', data);
    this.deployer.logger.log(message);
  }

  /**
   * Run after a migrations file has completed and the migration has been saved.
   * @param  {Boolean} isLast  true if this the last file in the sequence.
   */
  async postMigrate(isLast){
    let data = {};
    data.cost = this.getTotals().cost;
    this.summary[this.currentFileIndex].totalCost = data.cost;

    let message = this.messages.steps('postMigrate', data);
    this.deployer.logger.log(message);

    if (isLast){
      data.totalDeployments = this.getTotals().deployments;
      data.finalCost = this.getTotals().finalCost;

      this.summary.totalDeployments = data.totalDeployments;
      this.summary.finalCost = data.finalCost;

      message = this.messages.steps('lastMigrate', data);
      this.deployer.logger.log(message);
    }
  }

  // ----------------------------  Deployment Handlers --------------------------------------------

  /**
   * Runs after pre-flight estimate has executed, before the sendTx is attempted
   * @param  {Object} data
   */
  async preDeploy(data){
    let message;
    (data.deployed)
      ? message = this.messages.steps('replacing', data)
      : message = this.messages.steps('deploying', data);

    !this.deployingMany && this.deployer.logger.log(message);
  }

  /**
   * Run at intervals after the sendTx has executed, before the deployment resolves
   * @param  {Object} data
   */
  async block(data){
    this.currentBlockWait = `Blocks: ${data.blocksWaited}`.padEnd(21) +
                            `Seconds: ${data.secondsWaited}`;
    if (this.blockSpinner){
      this.blockSpinner.text = this.currentBlockWait;
    }
  }

  /**
   * Run after a deployment instance has resolved. This handler collects deployment cost
   * data and stores it a `summary` map so that it can later be replayed in an interactive
   * preview (e.g. dry-run --> real). Also passes this data to the messaging utility for
   * output formatting.
   * @param  {Object} data
   */
  async postDeploy(data){
    let message;
    if (data.deployed){
      const web3 = data.contract.web3;
      const tx = await data.contract.web3.eth.getTransaction(data.receipt.transactionHash);
      const balance = await data.contract.web3.eth.getBalance(tx.from);

      const gasPrice = new web3Utils.BN(tx.gasPrice);
      const gas = new web3Utils.BN(data.receipt.gasUsed);
      const value = new web3Utils.BN(tx.value);
      const cost = gasPrice.mul(gas).add(value);

      data.gasPrice = web3Utils.fromWei(gasPrice, 'gwei');
      data.gas = data.receipt.gasUsed;
      data.from = tx.from;
      data.value = web3Utils.fromWei(value, 'ether');
      data.cost = web3Utils.fromWei(cost, 'ether');
      data.balance = web3Utils.fromWei(balance, 'ether');

      this.currentGasTotal += data.gas;
      this.currentCostTotal = this.currentCostTotal.add(cost)
      this.currentAddress = this.from;
      this.deployments++;

      this.summary[this.currentFileIndex].deployments.push(data);
      message = this.messages.steps('deployed', data);
    } else {
      message = this.messages.steps('reusing', data);
    }

    this.deployer.logger.log(message);
  }

  /**
   * Runs on deployment error. Forwards err to the error parser/dispatcher after shutting down
   * any `pending` UI.
   * @param  {O} data [description]
   * @return {[type]}      [description]
   */
  async deployFailed(data){
    if (this.blockSpinner){
      this.blockSpinner.stop();
    }

    await this.processDeploymentError(data);
  }

  // ----------------------------  Library Event Handlers ------------------------------------------
  linking(data){
    let message = this.messages.steps('linking', data);
    this.deployer.logger.log(message);
  }


  // ----------------------------  PromiEvent Handlers --------------------------------------------

  /**
   * For misc error reporting that requires no context specific UI mgmt
   * @param  {Object} data
   */
  async error(data){
    let message = this.messages.errors(data.type, data);
    this.deployer.logger.error(message);
  }

  /**
   * Fired on Web3Promievent 'transactionHash' event. Begins running a UI
   * a block / time counter.
   * @param  {Object} data
   */
  async hash(data){
    if (this.migration.dryRun) return;

    let message = this.messages.steps('hash', data);
    this.deployer.logger.log(message);

    this.currentBlockWait = `Blocks: 0`.padEnd(21) +
                            `Seconds: 0`;

    this.blockSpinner = new ora({
      text: this.currentBlockWait,
      spinner: indentedSpinner,
      color: 'red'
    });

    this.blockSpinner.start();
  }

  /**
   * Fired on Web3Promievent 'confirmation' event. Begins running a UI
   * a block / time counter.
   * @param  {Object} data
   */
  async confirmation(data){
    let message = this.messages.steps('confirmation', data);
    this.deployer.logger.log(message);
  }

  // ----------------------------  Batch Handlers --------------------------------------------------

  async preDeployMany(batch){
    let message = this.messages.steps('many');

    this.deployingMany = true;
    this.deployer.logger.log(message);

    batch.forEach(item => {
      Array.isArray(item)
        ? message = this.messages.steps('listMany', item[0])
        : message = this.messages.steps('listMany', item)

      this.deployer.logger.log(message);
    })

    this.deployer.logger.log(this.separator);
  }

  async postDeployMany(){
    this.deployingMany = false;
  }

}

module.exports = Reporter;

