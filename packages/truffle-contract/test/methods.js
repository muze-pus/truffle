var assert = require("chai").assert;
var BigNumber = require("bignumber.js");
var util = require('./util');
var contract = require("../");

describe("Methods", function() {
  var Example;
  var accounts;
  var network_id;
  var web3;
  var providerOptions = {vmErrorsOnRPCResponse: false};

  before(function() {
    this.timeout(10000);

    Example = util.createExample();

    return util
      .setUpProvider(Example, providerOptions)
      .then(result => {
        web3 = result.web3;
        accounts = result.accounts;
      });
  });

  describe(".method(): success [ @geth ]", function(){

    it("should get and set values via methods and get values via .call", async function() {
      let value;
      const example = await Example.new(1)
      value = await example.value.call();

      assert.equal(value.valueOf(), 1, "Starting value should be 1");

      await example.setValue(5);
      value = await example.value.call();

      assert.equal(parseInt(value), 5, "Ending value should be five");
    });

    it("should execute constant functions as calls", async function() {
      const example = await Example.new(5)
      const value = await example.getValue();

      assert.equal(parseInt(value), 5, "Should not need to explicitly use .call()");
    });

    it("should execute overloaded solidity function calls", async function() {
      const example = await Example.new(5)
      const valueA = await example.methods['overloadedGet()']();
      const valueB = await example.methods['overloadedGet(uint256)'](5);

      assert.equal(parseInt(valueA), 5, "Value should have been retrieved");
      assert.equal(parseInt(valueB), 25, "Multiplied should have been retrieved");
    })

    it("should honor the defaultBlock parameter when called", async function(){
      const expectedInitialValue = 5;

      const example = await Example.new(expectedInitialValue);
      const initialBlock = await web3.eth.getBlockNumber();
      const tx = await example.setValue(10);

      const nextBlock = tx.receipt.blockNumber;
      const retrievedInitialValue = await example.getValue(initialBlock);

      assert.notEqual(initialBlock, nextBlock, "blockNumbers should differ");
      assert.equal(expectedInitialValue, parseInt(retrievedInitialValue), "should get initial value");

      const amountToAdd = 10;
      const expectedValuePlus = expectedInitialValue + amountToAdd;
      const retrievedValuePlus = await example.getValuePlus(amountToAdd, initialBlock);

      assert.equal(expectedValuePlus, retrievedValuePlus, "should get inital value + 10");
    });

    it('should estimate gas', async function(){
      const example = await Example.new(5);
      const estimate = await example.setValue.estimateGas(25);

      assert.isNumber(estimate, 'Estimate should be a number');
      assert.isAbove(estimate, 0, 'Estimate should be non-zero');
    });

    it("should return hash, logs and receipt when using synchronised transactions", async function() {
      const example = await Example.new(1);
      const result = await example.triggerEvent();
      const log = result.logs[0];

      assert.isDefined(result.tx, "transaction hash wasn't returned");
      assert.isDefined(result.logs, "synchronized transaction didn't return any logs");
      assert.isDefined(result.receipt, "synchronized transaction didn't return a receipt");
      assert.isOk(result.tx.length > 42, "Unexpected transaction hash");
      assert.equal(result.tx, result.receipt.transactionHash, "Tx had different hash than receipt");
      assert.equal(result.logs.length, 1, "logs array expected to be 1");
      assert.equal("ExampleEvent", log.event);
      assert.equal(accounts[0], log.args._from);
      assert.equal(8, log.args.num); // 8 is a magic number inside Example.sol
    });

    it("should allow BigNumbers as input params, not treat them as tx objects", async function() {
      let value;
      const example = await Example.new( new BigNumber(30))

      value = await example.value.call();
      assert.equal(value.valueOf(), 30, "Starting value should be 30");

      await example.setValue(new BigNumber(25));

      value = await example.value.call();
      assert.equal(value.valueOf(), 25, "Ending value should be twenty-five");

      value = await example.parrot.call(new BigNumber(865));
      assert.equal(parseInt(value), 865, "Parrotted value should equal 865")
    });

    it("should allow BN's as input paramss, not treat them as tx objects", async function() {
      let value;
      const example = await Example.new( new web3.utils.BN(30))

      value = await example.value.call();
      assert.equal(value.valueOf(), 30, "Starting value should be 30");

      await example.setValue(new web3.utils.BN(25));

      value = await example.value.call();
      assert.equal(value.valueOf(), 25, "Ending value should be twenty-five");

      value = await example.parrot.call(new web3.utils.BN(865));
      assert.equal(parseInt(value), 865, "Parrotted value should equal 865")
    });

    it("should emit a transaction hash", function(done){
      Example.new(5).then(function(instance) {
        instance.setValue(25).on('transactionHash', function(hash){
          assert.isString(hash, 'Transaction hash should be a string');
          assert.isOk(hash.length > 42, "Unexpected transaction hash");
          done();
        });
      })
    });

    it("should emit a receipt", function(done){
      Example.new(5).then(function(instance) {
        instance.setValue(25).on('receipt', function(receipt){
          assert.isObject(receipt, 'receipt should be an object');
          assert.isDefined(receipt.transactionHash, "receipt should have transaction hash");
          done();
        });
      })
    });

    it("should fire the confirmations event handler repeatedly", function(done){
      let example;

      async function keepTransacting(){
        await example.setValue(5);
        await example.setValue(10);
        await example.setValue(15);
      };

      function handler(number, receipt){
        assert.equal(parseInt(receipt.status), 1, 'should have a receipt');
        if(number === 3) {
          this.removeAllListeners();
          done();
        }
      }

      Example.new(5).then(instance => {
        example = instance;
        example.setValue(25)
          .on('confirmation', handler)
          .then(keepTransacting);
      });
    });

    it("should execute overloaded solidity fn sends", async function() {
      let value;
      const example = await Example.new(1);

      value = await example.value.call();
      assert.equal(parseInt(value), 1, "Starting value should be 1");

      await example.methods['overloadedSet(uint256)'](5);

      value = await example.value.call();
      assert.equal(parseInt(value), 5, "Ending value should be five");

      await example.methods['overloadedSet(uint256,uint256)'](5, 5);

      value = await example.value.call();
      assert.equal(parseInt(value), 25, "Ending value should be twenty five");
    });

    it('should automatically fund a tx that costs more than default gas (90k)', async function(){
      this.timeout(10000);

      const defaultGas = 90000;
      const instance = await Example.new(1);
      const estimate = await instance.isExpensive.estimateGas(777);

      assert(estimate > defaultGas, "Estimate should be too high");

      await instance.isExpensive(777);
    });
  });


  describe(".method(): errors [ @geth ]", function(){
    // NB: call always takes +1 param: defaultBlock
    it('should validate method arguments for .calls', async function(){
      const example = await Example.new(5);
      try {
        await example.getValue('apples', 'oranges', 'pineapples');
        assert.fail();
      } catch(e){
        assert(e.message.includes('parameters'), 'should error on invalid params');
      }
    });

    it('should validate method arguments for .sends', async function(){
      const example = await Example.new(5);
      try {
        await example.setValue(5, 5);
        assert.fail();
      } catch(e){
        assert(e.message.includes('parameters'), 'should error on invalid params');
      }
    });

    it("should reject on OOG", async function(){
      const example = await Example.new(1);
      try {
        await example.setValue(10, {gas: 10});
        assert.fail();
      } catch(e){
        const errorCorrect = e.message.includes('exceeds gas limit') ||
                             e.message.includes('intrinsic gas too low');

        assert(errorCorrect, 'Should OOG');
      }
    });

    it("should emit OOG errors", function(done){
      Example.new(1).then(example => {
        example
          .setValue(10, {gas: 10})
          .on('error', e => {
            const errorCorrect = e.message.includes('exceeds gas limit') ||
                                 e.message.includes('intrinsic gas too low');

            assert(errorCorrect, 'Should OOG');
            done();
          })
          .catch(e => null);
      });
    });

    it("errors with receipt and revert message", async function(){
      const example = await Example.new(1)
      try {
        await example.triggerRequireError();
        assert.fail();
      } catch(e){
        assert(e.message.includes('revert'));
        assert(parseInt(e.receipt.status, 16) == 0)
      };
    });

    it("errors with receipt & assert message when gas specified", async function(){
      const example = await Example.new(1)
      try {
        await example.triggerAssertError({gas: 200000});
        assert.fail();
      } catch(e){
        assert(e.message.includes('invalid opcode'));
        assert(parseInt(e.receipt.status, 16) == 0)
      }
    });

    it("errors with receipt & assert message when gas not specified", async function(){
      const example = await Example.new(1)
      try {
        await example.triggerAssertError();
        assert.fail();
      } catch(e){
        assert(e.message.includes('invalid opcode'));
        assert(parseInt(e.receipt.status, 16) == 0)
      }
    });

    it("errors with receipt & assert message on internal OOG", async function(){
      this.timeout(25000);

      const example = await Example.new(1)
      try {
        await example.runsOutOfGas();
        assert.fail();
      } catch(e){
        assert(e.message.includes('invalid opcode'));
        assert(parseInt(e.receipt.status, 16) == 0)
      }
    });
  });

  describe('web3 wallet', function(){
    it("should work with a web3.accounts.wallet account", async function(){
      let value;

      // Create and fund wallet account
      const wallet = web3.eth.accounts.wallet.create(1);
      const providerAccounts = await web3.eth.getAccounts();
      await web3.eth.sendTransaction({
        from: providerAccounts[0],
        to: wallet["0"].address,
        value: web3.utils.toWei("1", 'ether')
      });

      const balance = await web3.eth.getBalance(wallet["0"].address);
      assert.equal(balance, web3.utils.toWei("1", 'ether'));

      Example.setWallet(wallet);
      const example = await Example.new(1, {from: wallet["0"].address })

      value = await example.value.call();
      assert.equal(parseInt(value), 1, "Starting value should be 1");

      await example.setValue(5, {from: wallet["0"].address})

      value = await example.value.call();
      assert.equal(parseInt(value), 5, "Ending value should be 5");
    });
  });

  describe('sendTransaction() / send() [ @geth ]', function(){
    it("should trigger the fallback function when calling sendTransaction()", async function() {
      const example = await Example.new(1)
      const triggered = await example.fallbackTriggered();

      assert(triggered == false, "Fallback should not have been triggered yet");

      await example.sendTransaction({
        value: web3.utils.toWei("1", "ether")
      });

      const balance = await web3.eth.getBalance(example.address);
      assert(balance == web3.utils.toWei("1", "ether"), "Balance should be 1 ether");
    });

    it("should trigger the fallback function when calling send() (shorthand notation)", async function() {
      const example = await Example.new(1);
      const triggered = await example.fallbackTriggered();

      assert(triggered == false, "Fallback should not have been triggered yet");

      await example.send(web3.utils.toWei("1", "ether"));

      const balance = await web3.eth.getBalance(example.address);
      assert(balance == web3.utils.toWei("1", "ether"));
    });
  })
});