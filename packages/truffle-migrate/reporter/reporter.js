/**
 * Example reporter class that emulates the classic logger behavior
 */

const util = require('util');
const web3Utils = require('web3-utils');
const spinner = require('./indentedSpinner');

class Reporter {
  constructor(){
    console.log('running reporter constructor')
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
  }

  listen(){
    this.migration.emitter.on('preMigrate',     this.preMigrate.bind(this));
    this.migration.emitter.on('saveMigration',  this.saveMigrate.bind(this));
    this.migration.emitter.on('postMigrate',    this.postMigrate.bind(this));
    this.migration.emitter.on('error',          this.error.bind(this));

    this.deployer.emitter.on('preDeploy',       this.preDeploy.bind(this));
    this.deployer.emitter.on('postDeploy',      this.postDeploy.bind(this));
    this.deployer.emitter.on('preDeployMany',   this.preDeployMany.bind(this));
    this.deployer.emitter.on('postDeployMany',  this.postDeployMany.bind(this));
    this.deployer.emitter.on('deployFailed',    this.deployFailed.bind(this));
    this.deployer.emitter.on('linking',         this.linking.bind(this));
    this.deployer.emitter.on('error',           this.error.bind(this));
    this.deployer.emitter.on('transactionHash', this.hash.bind(this));
    this.deployer.emitter.on('receipt',         this.receipt.bind(this));
    this.deployer.emitter.on('confirmation',    this.confirmation.bind(this));
  }

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

  async preMigrate(data){
    let message;
    if (data.isFirst){
      message = this.messages('firstMigrate', data);
      this.deployer.logger.log(message);
    }

    this.summary.push({
      file: data.file,
      deployments: [],
    });

    this.currentFileIndex++;

    message = this.messages('preMigrate', data);
    this.deployer.logger.log(message);
  }

  async saveMigrate(data){
    const message = this.messages('saving', data);
    this.deployer.logger.log(message);
  }

  async postMigrate(isLast){
    let data = {};
    data.cost = this.getTotals().cost;
    this.summary[this.currentFileIndex].totalCost = data.cost;

    let message = this.messages('postMigrate', data);
    this.deployer.logger.log(message);

    if (isLast){
      data.totalDeployments = this.getTotals().deployments;
      data.finalCost = this.getTotals().finalCost;

      this.summary.totalDeployments = data.totalDeployments;
      this.summary.finalCost = data.finalCost;

      message = this.messages('lastMigrate', data);
      this.deployer.logger.log(message);
    }
  }

  async migrationError(data){
    this.summary[this.currentFileIndex].errored = true;
    const message = this.messages('migrateErr', data);
    this.deployer.logger.log(message);
  }

  async preDeploy(data){
    let message;
    (data.deployed)
      ? message = this.messages('replacing', data)
      : message = this.messages('deploying', data);

    !this.deployingMany && this.deployer.logger.log(message);
  }

  async postDeploy(data){
    let message;
    if (data.deployed){
      const web3 = data.contract.web3;
      const tx = await data.contract.web3.eth.getTransaction(data.receipt.transactionHash);
      const balance = await data.contract.web3.eth.getBalance(tx.from);

      const gasPrice = new web3Utils.BN(tx.gasPrice);
      const gas = new web3Utils.BN(data.receipt.gasUsed);
      const cost = gasPrice.mul(gas);

      data.gasPrice = web3Utils.fromWei(gasPrice, 'gwei');
      data.gas = data.receipt.gasUsed;
      data.from = tx.from;
      data.cost = web3Utils.fromWei(cost, 'ether');
      data.balance = web3Utils.fromWei(balance, 'ether');

      this.currentGasTotal += data.gas;
      this.currentCostTotal = this.currentCostTotal.add(cost)
      this.currentAddress = this.from;
      this.deployments++;

      this.summary[this.currentFileIndex].deployments.push(data);
      message = this.messages('deployed', data);
    } else {
      message = this.messages('notDeployed', data);
    }

    this.deployer.logger.log(message);
  }

  async preDeployMany(batch){
    let message = this.messages('many');

    this.deployingMany = true;
    this.deployer.logger.log(message);

    batch.forEach(item => {
      Array.isArray(item)
        ? message = this.messages('listMany', item[0])
        : message = this.messages('listMany', item)

      this.deployer.logger.log(message);
    })

    this.deployer.logger.log(this.separator);
  }

  async postDeployMany(){
    this.deployingMany = false;
  }

  async deployFailed(data){
    const message = await this.processDeploymentError(data);
    this.deployer.logger.error(message)
  }

  linking(data){
    let message = this.messages('linking', data);
    this.deployer.logger.log(message);
  }

  async error(data){
    let message = this.messages(data.type, data);
    this.deployer.logger.error(message);
  }

  async hash(data){
    let message = this.messages('hash', data);
    this.deployer.logger.log(message);
  }

  async receipt(data){
    let message = this.messages('receipt', data);
  }

  async confirmation(data){
    let message = this.messages('confirmation', data);
    this.deployer.logger.log(message);
  }

  underline(msg){
    return (typeof msg === 'number')
      ? `   ${'-'.repeat(msg)}`
      : `\n   ${msg}\n   ${'-'.repeat(msg.length)}`;
  }

  doubleline(msg){
    const ul = '='.repeat(msg.length);
    return `\n${msg}\n${ul}`;
  }

  messages(kind, data){
    const self = this;

    const prefix = '\nError:';
    const kinds = {

      // --------------------------------------- Errors --------------------------------------------
      migrateErr:   () =>
        `Exiting: Review successful transactions manually by checking the transaction hashes ` +
        `above on Etherscan.\n`,

      noLibName:    () =>
        `${prefix} Cannot link a library with no name.\n`,

      noLibAddress: () =>
        `${prefix} "${data.contract.contractName}" has no address. Has it been deployed?\n`,

      noBytecode:   () =>
        `${prefix} "${data.contract.contractName}" ` +
        `is an abstract contract or an interface and cannot be deployed\n` +
        `   * Hint: just import the contract into the '.sol' file that uses it.\n`,

      intWithGas:   () =>
        `${prefix} "${data.contract.contractName}" ran out of gas ` +
        `(using a value you set in your network config or deployment parameters.)\n` +
        `   * Block limit:  ${data.blockLimit}\n` +
        `   * Gas sent:     ${data.gas}\n`,

      intNoGas:     () =>
        `${prefix} "${data.contract.contractName}" ran out of gas ` +
        `(using Truffle's estimate.)\n` +
        `   * Block limit:  ${data.blockLimit}\n` +
        `   * Gas sent:     ${data.estimate}\n` +
        `   * Try:\n` +
        `      + Setting a higher gas estimate multiplier for this contract\n` +
        `      + Using the solc optimizer settings in 'truffle.js'\n` +
        `      + Making your contract smaller\n` +
        `      + Making your contract constructor more efficient\n` +
        `      + Setting a higher network block limit if you are on a\n` +
        `        private network or test client (like ganache).\n`,

      oogNoGas:     () =>
        `${prefix} "${data.contract.contractName}" ran out of gas. Something in the constructor ` +
        `(ex: infinite loop) caused gas estimation to fail. Try:\n` +
        `   * Making your contract constructor more efficient\n` +
        `   * Setting the gas manually in your config or as a deployment parameter\n` +
        `   * Using the solc optimizer settings in 'truffle.js'\n` +
        `   * Setting a higher network block limit if you are on a\n` +
        `     private network or test client (like ganache).\n`,

      rvtReason:    () =>
        `${prefix} "${data.contract.contractName}" hit a require or revert statement ` +
        `with the following reason given:\n` +
        `   * ${data.reason}\n`,

      rvtNoReason:  () =>
        `${prefix} "${data.contract.contractName}" hit a require or revert statement ` +
        `somewhere in its constructor. Try:\n` +
        `   * Verifying that your constructor params satisfy all require conditions.\n` +
        `   * Adding reason strings to your require statements.\n`,

      asrtNoReason: () =>
        `${prefix} "${data.contract.contractName}" hit an invalid opcode while deploying. Try:\n` +
        `   * Verifying that your constructor params satisfy all assert conditions.\n` +
        `   * Verifying your constructor code doesn't access an array out of bounds.\n` +
        `   * Adding reason strings to your assert statements.\n`,

      noMoney:      () =>
        `${prefix} "${data.contract.contractName}" could not deploy due to insufficient funds\n` +
        `   * Account:  ${data.from}\n` +
        `   * Balance:  ${data.balance} wei\n` +
        `   * Message:  ${data.error.message}\n` +
        `   * Try:\n` +
        `      + Using an adequately funded account\n` +
        `      + If you are using a local Geth node, verify that your node is synced.\n`,

      blockWithGas: () =>
        `${prefix} "${data.contract.contractName}" exceeded the block limit ` +
        `(with a gas value you set).\n` +
        `   * Block limit:  ${data.blockLimit}\n` +
        `   * Gas sent:     ${data.gas}\n` +
        `   * Try:\n` +
        `      + Sending less gas.\n` +
        `      + Setting a higher network block limit if you are on a\n` +
        `        private network or test client (like ganache).\n`,

      blockNoGas:   () =>
        `${prefix} "${data.contract.contractName}" exceeded the block limit ` +
        `(using Truffle's estimate).\n` +
        `   * Block limit: ${data.blockLimit}\n` +
        `   * Report this error in the Truffle issues on Github. It should not happen.\n` +
        `   * Try: setting gas manually in 'truffle.js' or as parameter to 'deployer.deploy'\n`,

      nonce:        () =>
        `${prefix} "${data.contract.contractName}" received: ${data.error.message}.\n` +
        `   * This error is common when Infura is under heavy network load.\n` +
        `   * Try: setting the 'confirmations' key in your network config\n` +
        `          to wait for several block confirmations between each deployment.\n`,

      geth:        () =>
        `${prefix} "${data.contract.contractName}" received a generic error from Geth that\n` +
        `can be caused by hitting revert in a contract constructor or running out of gas.\n` +
        `   * ${data.estimateError.message}.\n` +
        `   * Try: + using the '--dry-run' option to reproduce this failure with clearer errors.\n` +
        `          + verifying that your gas is adequate for this deployment.\n`,

      default:      () =>
        `${prefix} "${data.contract.contractName}" -- ${data.error.message}.\n`,

      // ------------------------------------ Successes --------------------------------------------

      deploying:    () =>
        this.underline(`Deploying '${data.contract.contractName}'`),

      replacing:    () =>
        this.underline(`Replacing '${data.contract.contractName}'`),

      reusing:      () =>
        this.underline(`Re-using  '${data.contract.contractName}'`),

      many:         () =>
        this.underline(`Deploying Batch`),

      linking:      () => {
        let output = this.underline(`Linking`) +
        `\n   * Contract: ${data.contractName} <--> Library: ${data.libraryName} `;

        if(!self.migration.dryRun)
          output +=`(at address: ${data.libraryAddress})`;

        return output;
      },

      preMigrate:   () =>
        this.doubleline(`${data.file}`),

      saving:       () => {
        return (!self.migration.dryRun)
          ? `\n   * Saving migration`
          : '';
      },

      firstMigrate: () => {
        let output;
        (self.migration.dryRun)
          ? output = this.doubleline(`Migrations dry-run (simulation)`) + '\n'
          : output = this.doubleline(`Starting migrations...`) + '\n';


        output +=
          `> Network name: '${data.network}'\n` +
          `> Network id:   ${data.networkId}\n`;

        return output;
      },

      postMigrate:  () => {
        let output = '';

        if (!self.migration.dryRun)
          output += `   * Saving artifacts\n`;

        output += this.underline(37) + '\n' +
          `   > ${'Total cost:'.padEnd(15)} ${data.cost.padStart(15)} ETH\n`;

        return output;
      },

      lastMigrate: () =>
        this.doubleline('Summary') + '\n' +
        `> ${'Total deployments:'.padEnd(20)} ${data.totalDeployments}\n` +
        `> ${'Final cost:'.padEnd(20)} ${data.finalCost} ETH\n`,

      deployed:     () => {
        let output = '';

        if(!self.migration.dryRun) output +=
          `   > ${'contract address:'.padEnd(20)} ${data.receipt.contractAddress}\n`;

        output +=
          `   > ${'account:'.padEnd(20)} ${data.from}\n` +
          `   > ${'balance:'.padEnd(20)} ${data.balance}\n` +
          `   > ${'cost:'.padEnd(20)} ${data.cost} ETH\n` +
          `   > ${'gas used:'.padEnd(20)} ${data.gas}\n` +
          `   > ${'gas price:'.padEnd(20)} ${data.gasPrice} gwei\n`;

        if (self.confirmations !== 0) output +=
          this.underline(`Pausing for ${self.confirmations} confirmations...`);

        return output;
      },

      listMany:     () =>
        `   * ${data.contractName}`,

      hash:         () => {
        return (!self.migration.dryRun)
          ? `   > ${'transaction hash:'.padEnd(20)} ` + data.transactionHash
          : ''
      },

      receipt:      () =>
        `   > ${'gas usage:'.padEnd(20)} ` + data.gas,

      confirmation: () =>
        `   > ${'confirmation number:'.padEnd(20)} ` + `${data.num} (block: ${data.block})`,
    }

    return kinds[kind]();
  }

  async processDeploymentError(data){
    let message;
    const error = data.estimateError || data.error;

    data.reason = (data.error) ? data.error.reason : null;

    const errors = {
      INT: error.message.includes('base fee') || error.message.includes('intrinsic'),
      OOG: error.message.includes('out of gas'),
      RVT: error.message.includes('revert'),
      ETH: error.message.includes('funds'),
      BLK: error.message.includes('block gas limit'),
      NCE: error.message.includes('nonce'),
      INV: error.message.includes('invalid opcode'),
      GTH: error.message.includes('always failing transaction')
    }

    let type = Object.keys(errors).find(key => errors[key]);

    switch (type) {
      case 'INT':
        (data.gas)
          ? message = this.messages('intWithGas', data)
          : message = this.messages('intNoGas', data);

        this.deployer.logger.error(message);
        break;

      case 'OOG':
        (data.gas)
          ? message = this.messages('intWithGas', data)
          : message = this.messages('oogNoGas', data);

        this.deployer.logger.error(message);
        break;

      case 'RVT':
        (data.reason)
          ? message = this.messages('rvtReason', data)
          : message = this.messages('rvtNoReason', data);

        this.deployer.logger.error(message);
        break;

      case 'INV':
        (data.reason)
          ? message = this.messages('asrtReason', data)
          : message = this.messages('asrtNoReason', data);

        this.deployer.logger.error(message);
        break;

      case 'BLK':
        (data.gas)
          ? message = this.messages('blockWithGas', data)
          : message = this.messages('blockNoGas', data)

        this.deployer.logger.error(message);
        break;

      case 'ETH':
        const balance = await data.contract.web3.eth.getBalance(data.from);
        data.balance = balance.toString();
        message = this.messages('noMoney', data);
        this.deployer.logger.error(message);
        break;

      case 'NCE':
        message = this.messages('nonce', data);
        this.deployer.logger.error(message);
        break;

      case 'GTH':
        message = this.messages('geth', data);
        this.deployer.logger.error(message);
        break;

      default:
        message = this.messages('default', data);
        this.deployer.logger.error(message);
    }
  }
}

module.exports = Reporter;