const expect = require("truffle-expect");
const Emittery = require('emittery');
const DeferredChain = require("./src/deferredchain");
const Deployment = require("./src/deployment");
const link = require("./src/actions/link");
const create = require("./src/actions/new");

class Deployer extends Deployment {

  constructor(options){
    options = options || {};
    expect.options(options, [
      "provider",
      "network",
      "network_id"
    ]);

    const emitter = new Emittery();
    super(emitter);

    this.emitter = emitter;
    this.chain = new DeferredChain();
    this.logger = options.logger || {log: function() {}};
    this.network = options.network;
    this.network_id = options.network_id;
    this.provider = options.provider;
    this.basePath = options.basePath || process.cwd();
    this.known_contracts = {};

    (options.contracts || [])
      .forEach(contract => this.known_contracts[contract.contract_name] = contract);
  }

  // Note: In all code below we overwrite this.chain every time .then() is used
  // in order to ensure proper error processing.
  start() {
    return this.chain.start()
  }

  link(library, destinations){
    return this.queueOrExec(link(library, destinations, this))
  }


  deploy() {
    const args = Array.prototype.slice.call(arguments);
    const contract = args.shift();

    return (Array.isArray(contract))
      ? this.queueOrExec(this._deployMany(contract, this))
      : this.queueOrExec(this._deploy(contract, args, this));
  }

  new() {
    const args = Array.prototype.slice.call(arguments);
    const contract = args.shift();

    return this.queueOrExec(create(contract, args, this));
  }

  then(fn) {
    var self = this;

    return this.queueOrExec(function(){
      return fn(this);
    });
  }

  queueOrExec(fn){
    var self = this;

    return (this.chain.started == true)
      ? new Promise(accept => accept()).then(fn)
      : this.chain.then(fn);
  }

  finish(){
    this.emitter.clearListeners();
    this._close();
  }
}

module.exports = Deployer;
